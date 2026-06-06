// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { IAgentRequester, Request, Response, ResponseStatus } from "../SomniaAgentInterfaces.sol";

interface IJsonApiAgent {
    function fetchString(string calldata url, string calldata selector)
        external
        returns (string memory response);
}

interface IParseWebsiteAgent {
    function ExtractString(
        string calldata key,
        string calldata description,
        string[] calldata options,
        string calldata prompt,
        string calldata url,
        bool resolveUrl,
        uint8 numPages,
        uint8 confidenceThreshold
    ) external returns (string memory response);
}

interface ILLMInferenceAgent {
    function inferString(
        string calldata prompt,
        string calldata system,
        bool chainOfThought,
        string[] calldata allowedValues
    ) external returns (string memory response);
}

/**
 * @title ApprovalRiskScanner
 * @notice revoke.cash-style approval scanner. A scan stores many approval rows but sends exactly
 *         three batched agent requests total: JSON API, Parse Website, and LLM Inference.
 */
contract ApprovalRiskScanner is ReentrancyGuard {
    uint256 public constant AGENT_SUBCOMMITTEE_SIZE = 3;
    uint256 public constant MAX_ITEMS_PER_SCAN = 50;
    uint256 public constant STAGES_PER_SCAN = 3;

    address public admin;
    IAgentRequester public agentPlatform;
    uint256 public jsonApiAgentId;
    uint256 public parseWebsiteAgentId;
    uint256 public llmInferenceAgentId;
    uint256 public agentRewardPerCall = 0.01 ether;
    uint256 public nextScanId = 1;

    enum Stage {
        None,
        JsonApi,
        ParseWebsite,
        Inference
    }

    enum ItemStatus {
        None,
        Pending,
        Inferring,
        Complete
    }

    struct ApprovalItem {
        uint256 chainId;
        address spender;
        address token;
        string context;
        string explorerApiUrl;
        string explorerApiSelector;
        string explorerPageUrl;
    }

    struct ItemState {
        uint256 chainId;
        address spender;
        address token;
        string context;
        bool jsonReturned;
        bool webReturned;
        bool inferenceFired;
        ItemStatus status;
        string jsonFacts;
        string webFindings;
        uint8 riskScore;
        string verdict;
    }

    struct Scan {
        address requester;
        uint256 escrow;
        uint256 agentDeposit;
        uint256 itemCount;
        uint256 completedCount;
        bool jsonReturned;
        bool webReturned;
        bool inferenceFired;
        bool inferenceSucceeded;
        string jsonFacts;
        string webFindings;
        string inferenceSummary;
        bool exists;
    }

    mapping(uint256 => Scan) public scans;
    mapping(uint256 => mapping(uint256 => ItemState)) internal _items;
    mapping(uint256 => uint256) private _requestRefs;

    error NotAdmin();
    error ZeroAddress();
    error AgentNotConfigured();
    error OnlyAgentPlatform();
    error UnknownAgentRequest();
    error InsufficientDeposit(uint256 required, uint256 provided);
    error EmptyBatch();
    error TooManyItems();
    error ScanNotFound();
    error NotScanRequester();
    error ScanNotComplete();
    error RefundFailed();

    event AgentsConfigured(
        address indexed platform,
        uint256 jsonApiAgentId,
        uint256 parseWebsiteAgentId,
        uint256 llmInferenceAgentId
    );
    event AgentRewardPerCallUpdated(uint256 newReward);
    event AdminUpdated(address indexed newAdmin);
    event ScanRequested(
        uint256 indexed scanId, address indexed requester, uint256 itemCount, uint256 escrow
    );
    event ItemStageRequested(
        uint256 indexed scanId, uint256 indexed itemIndex, Stage stage, uint256 requestId
    );
    event ItemStageReturned(
        uint256 indexed scanId, uint256 indexed itemIndex, Stage stage, bool success
    );
    event ItemScored(
        uint256 indexed scanId,
        uint256 indexed itemIndex,
        address indexed spender,
        uint8 riskScore,
        string verdict
    );
    event ScanCompleted(uint256 indexed scanId, uint256 itemCount);
    event EscrowRefunded(uint256 indexed scanId, address indexed to, uint256 amount);
    event AgentRebateReceived(address indexed sender, uint256 amount);

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    receive() external payable {
        emit AgentRebateReceived(msg.sender, msg.value);
    }

    // --- admin / configuration ---------------------------------------------------------------

    function configureAgents(
        address platform,
        uint256 jsonApiAgentId_,
        uint256 parseWebsiteAgentId_,
        uint256 llmInferenceAgentId_
    ) external onlyAdmin {
        if (platform == address(0)) revert ZeroAddress();
        agentPlatform = IAgentRequester(platform);
        jsonApiAgentId = jsonApiAgentId_;
        parseWebsiteAgentId = parseWebsiteAgentId_;
        llmInferenceAgentId = llmInferenceAgentId_;
        emit AgentsConfigured(platform, jsonApiAgentId_, parseWebsiteAgentId_, llmInferenceAgentId_);
    }

    function setAgentRewardPerCall(uint256 newReward) external onlyAdmin {
        agentRewardPerCall = newReward;
        emit AgentRewardPerCallUpdated(newReward);
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        admin = newAdmin;
        emit AdminUpdated(newAdmin);
    }

    // --- user entrypoint ---------------------------------------------------------------------

    function requestScan(ApprovalItem[] calldata items)
        external
        payable
        nonReentrant
        returns (uint256 scanId)
    {
        if (address(agentPlatform) == address(0) || jsonApiAgentId == 0 || parseWebsiteAgentId == 0
            || llmInferenceAgentId == 0) {
            revert AgentNotConfigured();
        }
        if (items.length == 0) revert EmptyBatch();
        if (items.length > MAX_ITEMS_PER_SCAN) revert TooManyItems();

        uint256 deposit = _agentDeposit();
        uint256 required = STAGES_PER_SCAN * deposit;
        if (msg.value < required) revert InsufficientDeposit(required, msg.value);

        scanId = nextScanId++;
        scans[scanId] = Scan({
            requester: msg.sender,
            escrow: deposit,
            agentDeposit: deposit,
            itemCount: items.length,
            completedCount: 0,
            jsonReturned: false,
            webReturned: false,
            inferenceFired: false,
            inferenceSucceeded: false,
            jsonFacts: "",
            webFindings: "",
            inferenceSummary: "",
            exists: true
        });

        for (uint256 i; i < items.length; ++i) {
            ApprovalItem calldata item = items[i];
            ItemState storage state = _items[scanId][i];
            state.chainId = item.chainId;
            state.spender = item.spender;
            state.token = item.token;
            state.context = item.context;
            state.status = ItemStatus.Pending;
        }

        _fireBatchJsonApi(scanId, items[0], deposit);
        _fireBatchParseWebsite(scanId, items[0], deposit);

        // Refund any overpayment immediately.
        uint256 excess = msg.value - required;
        if (excess > 0) {
            (bool ok,) = payable(msg.sender).call{ value: excess }("");
            if (!ok) revert RefundFailed();
        }

        emit ScanRequested(scanId, msg.sender, items.length, required);
    }

    // --- agent callbacks ---------------------------------------------------------------------

    function handleJsonApiResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external nonReentrant {
        (uint256 scanId, uint256 itemIndex) = _takeRequest(requestId, Stage.JsonApi);
        (string memory decoded, bool ok) = _decodeString(responses, status);
        _onStageReturn(scanId, itemIndex, Stage.JsonApi, decoded, ok);
    }

    function handleParseWebsiteResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external nonReentrant {
        (uint256 scanId, uint256 itemIndex) = _takeRequest(requestId, Stage.ParseWebsite);
        (string memory decoded, bool ok) = _decodeString(responses, status);
        _onStageReturn(scanId, itemIndex, Stage.ParseWebsite, decoded, ok);
    }

    function handleInferenceResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external nonReentrant {
        (uint256 scanId,) = _takeRequest(requestId, Stage.Inference);
        Scan storage scan = scans[scanId];
        if (scan.completedCount == scan.itemCount) return;

        (string memory decoded, bool ok) = _decodeString(responses, status);
        scan.inferenceSucceeded = ok;
        scan.inferenceSummary = ok && bytes(decoded).length > 0
            ? decoded
            : "Agent batch summary unavailable; deterministic risk level used.";
        scan.completedCount = scan.itemCount;

        if (scan.completedCount == scan.itemCount) {
            emit ScanCompleted(scanId, scan.itemCount);
        }
    }

    // --- views -------------------------------------------------------------------------------

    function getItem(uint256 scanId, uint256 itemIndex) external view returns (ItemState memory) {
        if (!scans[scanId].exists) revert ScanNotFound();
        return _viewItem(scanId, itemIndex);
    }

    function getScan(uint256 scanId) external view returns (Scan memory) {
        if (!scans[scanId].exists) revert ScanNotFound();
        return scans[scanId];
    }

    function getScanResult(uint256 scanId)
        external
        view
        returns (Scan memory scan, ItemState[] memory items)
    {
        scan = scans[scanId];
        if (!scan.exists) revert ScanNotFound();
        items = new ItemState[](scan.itemCount);
        for (uint256 i; i < scan.itemCount; ++i) {
            items[i] = _viewItem(scanId, i);
        }
    }

    function getRequestRef(uint256 requestId)
        external
        view
        returns (uint256 scanId, uint256 itemIndex, Stage stage, bool exists)
    {
        return _unpackRequestRef(_requestRefs[requestId]);
    }

    function isScanComplete(uint256 scanId) external view returns (bool) {
        Scan memory scan = scans[scanId];
        return scan.exists && scan.completedCount == scan.itemCount;
    }

    function quoteScan(uint256 itemCount) external view returns (uint256 requiredDeposit) {
        return itemCount == 0 ? 0 : STAGES_PER_SCAN * _agentDeposit();
    }

    function claimRefund(uint256 scanId) external nonReentrant {
        Scan storage scan = scans[scanId];
        if (!scan.exists) revert ScanNotFound();
        if (msg.sender != scan.requester) revert NotScanRequester();
        if (scan.completedCount != scan.itemCount) revert ScanNotComplete();

        uint256 amount = scan.escrow;
        if (amount == 0) return;
        scan.escrow = 0;
        (bool ok,) = payable(scan.requester).call{ value: amount }("");
        if (!ok) revert RefundFailed();
        emit EscrowRefunded(scanId, scan.requester, amount);
    }

    // --- internal: agent dispatch ------------------------------------------------------------

    function _fireBatchJsonApi(
        uint256 scanId,
        ApprovalItem calldata firstItem,
        uint256 deposit
    ) private {
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchString.selector,
            firstItem.explorerApiUrl,
            firstItem.explorerApiSelector
        );
        uint256 requestId = agentPlatform.createRequest{ value: deposit }(
            jsonApiAgentId, address(this), this.handleJsonApiResponse.selector, payload
        );
        _recordRequest(requestId, scanId, 0, Stage.JsonApi);
        emit ItemStageRequested(scanId, 0, Stage.JsonApi, requestId);
    }

    function _fireBatchParseWebsite(
        uint256 scanId,
        ApprovalItem calldata firstItem,
        uint256 deposit
    ) private {
        string[] memory options = new string[](0);
        bytes memory payload = abi.encodeWithSelector(
            IParseWebsiteAgent.ExtractString.selector,
            "batch-risk",
            "Security reputation and red flags for a batch of token approval spender contracts.",
            options,
            _batchParsePrompt(scanId, firstItem.spender),
            firstItem.explorerPageUrl,
            false,
            uint8(1),
            uint8(50)
        );
        uint256 requestId = agentPlatform.createRequest{ value: deposit }(
            parseWebsiteAgentId, address(this), this.handleParseWebsiteResponse.selector, payload
        );
        _recordRequest(requestId, scanId, 0, Stage.ParseWebsite);
        emit ItemStageRequested(scanId, 0, Stage.ParseWebsite, requestId);
    }

    function _fireBatchInference(uint256 scanId) private {
        Scan storage scan = scans[scanId];
        uint256 deposit = scan.agentDeposit;
        scan.escrow -= deposit;
        scan.inferenceFired = true;

        string[] memory allowedValues = new string[](0);
        bytes memory payload = abi.encodeWithSelector(
            ILLMInferenceAgent.inferString.selector,
            _batchInferencePrompt(scanId),
            _inferenceSystemPrompt(),
            false,
            allowedValues
        );
        uint256 requestId = agentPlatform.createRequest{ value: deposit }(
            llmInferenceAgentId, address(this), this.handleInferenceResponse.selector, payload
        );
        _recordRequest(requestId, scanId, 0, Stage.Inference);
        emit ItemStageRequested(scanId, 0, Stage.Inference, requestId);
    }

    function _onStageReturn(
        uint256 scanId,
        uint256,
        Stage stage,
        string memory decoded,
        bool ok
    ) private {
        Scan storage scan = scans[scanId];
        if (stage == Stage.JsonApi) {
            if (scan.jsonReturned) return;
            scan.jsonReturned = true;
            scan.jsonFacts = ok && bytes(decoded).length > 0
                ? decoded
                : "source facts unavailable";
        } else {
            if (scan.webReturned) return;
            scan.webReturned = true;
            scan.webFindings = ok && bytes(decoded).length > 0
                ? decoded
                : "website findings unavailable";
        }
        emit ItemStageReturned(scanId, 0, stage, ok);

        if (scan.jsonReturned && scan.webReturned && !scan.inferenceFired) {
            _fireBatchInference(scanId);
        }
    }

    // --- internal: helpers -------------------------------------------------------------------

    function _recordRequest(uint256 requestId, uint256 scanId, uint256 itemIndex, Stage stage)
        private
    {
        _requestRefs[requestId] = _packRequestRef(scanId, itemIndex, stage);
    }

    function _takeRequest(uint256 requestId, Stage expected)
        private
        returns (uint256 scanId, uint256 itemIndex)
    {
        if (msg.sender != address(agentPlatform)) revert OnlyAgentPlatform();
        Stage stage;
        bool exists;
        (scanId, itemIndex, stage, exists) = _unpackRequestRef(_requestRefs[requestId]);
        if (!exists || stage != expected) revert UnknownAgentRequest();
        delete _requestRefs[requestId];
    }

    function _packRequestRef(uint256 scanId, uint256 itemIndex, Stage stage)
        private
        pure
        returns (uint256)
    {
        return (scanId << 40) | (itemIndex << 8) | uint8(stage);
    }

    function _unpackRequestRef(uint256 packed)
        private
        pure
        returns (uint256 scanId, uint256 itemIndex, Stage stage, bool exists)
    {
        if (packed == 0) return (0, 0, Stage.None, false);
        stage = Stage(uint8(packed));
        itemIndex = (packed >> 8) & type(uint32).max;
        scanId = packed >> 40;
        exists = true;
    }

    function _decodeString(Response[] memory responses, ResponseStatus status)
        private
        view
        returns (string memory decoded, bool ok)
    {
        if (status != ResponseStatus.Success) {
            return ("", false);
        }
        for (uint256 i; i < responses.length; ++i) {
            if (responses[i].status != ResponseStatus.Success) continue;
            try this.decodeStringResult(responses[i].result) returns (string memory value) {
                return (value, true);
            } catch {
                return ("", false);
            }
        }
        return ("", false);
    }

    function decodeStringResult(bytes calldata result) external pure returns (string memory) {
        return abi.decode(result, (string));
    }

    function _agentDeposit() internal view returns (uint256) {
        return agentPlatform.getRequestDeposit() + (agentRewardPerCall * AGENT_SUBCOMMITTEE_SIZE);
    }

    function _inferenceSystemPrompt() internal pure returns (string memory) {
        return string.concat(
            "You are Somnia RiskGuard reviewing a batch of token approval spender contracts. ",
            "Use the supplied JSON API facts, parsed website findings, and approval rows. ",
            "Summarize red flags in short, clear language. Mention verification status, proxy risk, ",
            "creator/age/activity signals, warning labels, repeated spenders, unlimited allowances, ",
            "and NFT operator approvals when present. Do not invent facts that are not in the prompt."
        );
    }

    function _batchParsePrompt(uint256 scanId, address firstSpender)
        internal
        view
        returns (string memory prompt)
    {
        Scan storage scan = scans[scanId];
        prompt = string.concat(
            "Analyze this smart contract page on Somnia explorer as representative context ",
            "for this approval batch. Extract key information: contract name, verification status ",
            "(Verified/Unverified), proxy status, creator address, creation date, transaction count, ",
            "and any warnings or labels. Summarize red flags in short and clear language. ",
            "Batch size: ",
            Strings.toString(scan.itemCount),
            ". Representative spender address: ",
            Strings.toHexString(firstSpender),
            "."
        );
    }

    function _batchInferencePrompt(uint256 scanId) internal view returns (string memory prompt) {
        Scan storage scan = scans[scanId];
        prompt = string.concat(
            "Review this approval batch. There are ",
            Strings.toString(scan.itemCount),
            " active approvals. Summarize the main risks in one short paragraph.\n",
            "JSON API batch facts: ",
            bytes(scan.jsonFacts).length == 0 ? "none" : scan.jsonFacts,
            "\nParse Website batch findings: ",
            bytes(scan.webFindings).length == 0 ? "none" : scan.webFindings,
            "\nApproval rows:\n"
        );
        for (uint256 i; i < scan.itemCount; ++i) {
            ItemState storage state = _items[scanId][i];
            prompt = string.concat(
                prompt,
                "#",
                Strings.toString(i),
                " chain=",
                Strings.toString(state.chainId),
                " token=",
                Strings.toHexString(state.token),
                " spender=",
                Strings.toHexString(state.spender),
                " ",
                state.context,
                "\n"
            );
        }
    }

    function _viewItem(uint256 scanId, uint256 itemIndex)
        internal
        view
        returns (ItemState memory item)
    {
        Scan storage scan = scans[scanId];
        ItemState storage storedItem = _items[scanId][itemIndex];
        item = storedItem;
        item.jsonReturned = scan.jsonReturned;
        item.webReturned = scan.webReturned;
        item.inferenceFired = scan.inferenceFired;
        item.jsonFacts = _displayJsonFacts(storedItem, scan);
        item.webFindings = scan.completedCount == scan.itemCount
            ? scan.inferenceSummary
            : _displayWebFindings(scan);

        if (scan.completedCount == scan.itemCount) {
            item.status = ItemStatus.Complete;
            (item.riskScore, item.verdict) = _contextVerdict(scanId, itemIndex);
        } else if (scan.inferenceFired) {
            item.status = ItemStatus.Inferring;
        } else {
            item.status = ItemStatus.Pending;
        }
    }

    function _displayJsonFacts(ItemState storage item, Scan storage scan)
        internal
        view
        returns (string memory)
    {
        if (bytes(scan.jsonFacts).length > 0
            && keccak256(bytes(scan.jsonFacts)) != keccak256(bytes("source facts unavailable"))) {
            return scan.jsonFacts;
        }
        return string.concat("Active approval context: ", item.context);
    }

    function _displayWebFindings(Scan storage scan) internal view returns (string memory) {
        if (bytes(scan.webFindings).length > 0
            && keccak256(bytes(scan.webFindings)) != keccak256(bytes("website findings unavailable"))) {
            return scan.webFindings;
        }
        return "Website findings unavailable; using active approval context.";
    }

    function _contextVerdict(uint256 scanId, uint256 itemIndex)
        internal
        view
        returns (uint8 score, string memory verdict)
    {
        ItemState storage state = _items[scanId][itemIndex];
        bool nftOperator = _contains(state.context, "standard=erc721")
            || _contains(state.context, "standard=erc1155");
        bool unlimited = _contains(state.context, "allowance=unlimited")
            || _contains(state.context, "allowance=all");
        uint256 repeated = _spenderExposure(scanId, state.spender);

        if (nftOperator || (unlimited && repeated >= 3)) {
            return (80, "HIGH");
        }
        if (unlimited) {
            return (50, "MEDIUM");
        }
        return (20, "LOW");
    }

    function _spenderExposure(uint256 scanId, address spender) internal view returns (uint256 count) {
        Scan storage scan = scans[scanId];
        for (uint256 i; i < scan.itemCount; ++i) {
            if (_items[scanId][i].spender == spender) {
                count += 1;
            }
        }
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory hay = bytes(haystack);
        bytes memory ndl = bytes(needle);
        if (ndl.length == 0) return true;
        if (ndl.length > hay.length) return false;

        for (uint256 i; i <= hay.length - ndl.length; ++i) {
            bool matched = true;
            for (uint256 j; j < ndl.length; ++j) {
                if (hay[i + j] != ndl[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) return true;
        }
        return false;
    }

    function _scoreVerdict(string memory raw) internal pure returns (uint8 score, string memory verdict) {
        bytes32 hash = keccak256(bytes(raw));
        if (hash == keccak256(bytes("TRUSTED_LOW"))) return (10, "TRUSTED_LOW");
        if (hash == keccak256(bytes("LOW"))) return (25, "LOW");
        if (hash == keccak256(bytes("MEDIUM"))) return (50, "MEDIUM");
        if (hash == keccak256(bytes("HIGH"))) return (75, "HIGH");
        if (hash == keccak256(bytes("CRITICAL"))) return (95, "CRITICAL");
        return (100, "UNKNOWN");
    }
}
