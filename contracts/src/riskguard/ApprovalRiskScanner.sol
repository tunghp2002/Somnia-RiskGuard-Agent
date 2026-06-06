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
 * @notice revoke.cash-style risk scoring for token approvals, powered by three Somnia base
 *         agents. A single signed `requestScan` transaction escrows the agent deposits and, per
 *         approval item, fans out to the JSON API Request agent and the LLM Parse Website agent in
 *         parallel; once both return, an LLM Inference agent combines their findings into a 0-100
 *         risk score plus a short verdict. All agent calls are asynchronous: the Somnia agent
 *         platform calls back into this contract once consensus is reached.
 */
contract ApprovalRiskScanner is ReentrancyGuard {
    uint256 public constant AGENT_SUBCOMMITTEE_SIZE = 3;
    uint256 public constant MAX_ITEMS_PER_SCAN = 20;
    uint256 public constant STAGES_PER_ITEM = 3;

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
        uint256 required = items.length * STAGES_PER_ITEM * deposit;
        if (msg.value < required) revert InsufficientDeposit(required, msg.value);

        scanId = nextScanId++;
        scans[scanId] = Scan({
            requester: msg.sender,
            escrow: items.length * deposit,
            agentDeposit: deposit,
            itemCount: items.length,
            completedCount: 0,
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

            _fireJsonApi(scanId, i, item, deposit);
            _fireParseWebsite(scanId, i, item, deposit);
            // One deposit per item stays escrowed for the deferred inference call.
        }

        // Refund any overpayment immediately so retained escrow only covers deferred inference.
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
        (uint256 scanId, uint256 itemIndex) = _takeRequest(requestId, Stage.Inference);
        ItemState storage state = _items[scanId][itemIndex];
        if (state.status == ItemStatus.Complete) return;

        (string memory decoded, bool ok) = _decodeString(responses, status);
        uint8 score;
        string memory verdict;
        if (ok) {
            (score, verdict) = _scoreVerdict(decoded);
        } else {
            score = 100;
            verdict = "inference failed - treat as high risk";
        }

        state.riskScore = score;
        state.verdict = verdict;
        state.status = ItemStatus.Complete;

        Scan storage scan = scans[scanId];
        scan.completedCount += 1;

        emit ItemScored(scanId, itemIndex, state.spender, score, verdict);
        if (scan.completedCount == scan.itemCount) {
            emit ScanCompleted(scanId, scan.itemCount);
        }
    }

    // --- views -------------------------------------------------------------------------------

    function getItem(uint256 scanId, uint256 itemIndex) external view returns (ItemState memory) {
        if (!scans[scanId].exists) revert ScanNotFound();
        return _items[scanId][itemIndex];
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
            items[i] = _items[scanId][i];
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
        return itemCount * STAGES_PER_ITEM * _agentDeposit();
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

    function _fireJsonApi(uint256 scanId, uint256 i, ApprovalItem calldata item, uint256 deposit)
        private
    {
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchString.selector, item.explorerApiUrl, item.explorerApiSelector
        );
        uint256 requestId = agentPlatform.createRequest{ value: deposit }(
            jsonApiAgentId, address(this), this.handleJsonApiResponse.selector, payload
        );
        _recordRequest(requestId, scanId, i, Stage.JsonApi);
        emit ItemStageRequested(scanId, i, Stage.JsonApi, requestId);
    }

    function _fireParseWebsite(
        uint256 scanId,
        uint256 i,
        ApprovalItem calldata item,
        uint256 deposit
    ) private {
        string[] memory options = new string[](0);
        bytes memory payload = abi.encodeWithSelector(
            IParseWebsiteAgent.ExtractString.selector,
            "risk",
            "Security reputation of a smart contract a wallet has approved as a token spender.",
            options,
            string.concat(
                "Inspect this contract page and report any red flags (unverified source, proxy, ",
                "known scam/phishing label, drainer reports). Spender: ",
                Strings.toHexString(item.spender),
                ". Reply with a short phrase."
            ),
            item.explorerPageUrl,
            false,
            uint8(1),
            uint8(50)
        );
        uint256 requestId = agentPlatform.createRequest{ value: deposit }(
            parseWebsiteAgentId, address(this), this.handleParseWebsiteResponse.selector, payload
        );
        _recordRequest(requestId, scanId, i, Stage.ParseWebsite);
        emit ItemStageRequested(scanId, i, Stage.ParseWebsite, requestId);
    }

    function _fireInference(uint256 scanId, uint256 i) private {
        ItemState storage state = _items[scanId][i];
        Scan storage scan = scans[scanId];

        // CEI: flip guards and draw escrow before the external createRequest call.
        state.inferenceFired = true;
        state.status = ItemStatus.Inferring;
        uint256 deposit = scan.agentDeposit;
        scan.escrow -= deposit;

        string[] memory allowedValues = new string[](5);
        allowedValues[0] = "TRUSTED_LOW";
        allowedValues[1] = "LOW";
        allowedValues[2] = "MEDIUM";
        allowedValues[3] = "HIGH";
        allowedValues[4] = "CRITICAL";
        bytes memory payload = abi.encodeWithSelector(
            ILLMInferenceAgent.inferString.selector,
            _inferencePrompt(state),
            _inferenceSystemPrompt(),
            false,
            allowedValues
        );
        uint256 requestId = agentPlatform.createRequest{ value: deposit }(
            llmInferenceAgentId, address(this), this.handleInferenceResponse.selector, payload
        );
        _recordRequest(requestId, scanId, i, Stage.Inference);
        emit ItemStageRequested(scanId, i, Stage.Inference, requestId);
    }

    function _onStageReturn(
        uint256 scanId,
        uint256 i,
        Stage stage,
        string memory decoded,
        bool ok
    ) private {
        ItemState storage state = _items[scanId][i];
        if (stage == Stage.JsonApi) {
            if (state.jsonReturned) return;
            state.jsonReturned = true;
            state.jsonFacts = ok && bytes(decoded).length > 0
                ? decoded
                : "source facts unavailable";
        } else {
            if (state.webReturned) return;
            state.webReturned = true;
            state.webFindings = ok && bytes(decoded).length > 0
                ? decoded
                : "website findings unavailable";
        }
        emit ItemStageReturned(scanId, i, stage, ok);

        if (state.jsonReturned && state.webReturned && !state.inferenceFired) {
            _fireInference(scanId, i);
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
            "You are Somnia RiskGuard scoring the risk of a token approval (spender contract). ",
            "Reply with exactly one allowed value: TRUSTED_LOW, LOW, MEDIUM, HIGH, or CRITICAL. ",
            "Score the spender's ability and likelihood to misuse the approval, not the token brand. ",
            "A trusted stablecoin token does not make an unknown spender safe. ",
            "Unlimited allowance alone is usually MEDIUM for a verified/known spender with no red flags; ",
            "use HIGH only when the spender is unknown, unverified, proxy-risky, has weak facts, or has warnings. ",
            "Use TRUSTED_LOW only for clearly reputable/verified spenders with no warning signs and limited exposure."
        );
    }

    function _inferencePrompt(ItemState storage state) internal view returns (string memory) {
        return string.concat(
            "Score the risk of this token approval.\nChain id: ",
            Strings.toString(state.chainId),
            "\nToken: ",
            Strings.toHexString(state.token),
            "\nSpender: ",
            Strings.toHexString(state.spender),
            "\nContext: ",
            state.context,
            "\nOn-chain/explorer facts: ",
            bytes(state.jsonFacts).length == 0 ? "none" : state.jsonFacts,
            "\nWebsite findings: ",
            bytes(state.webFindings).length == 0 ? "none" : state.webFindings,
            "\nDecision guide: TRUSTED_LOW=reputable verified spender and no red flags; ",
            "LOW=limited approval or low exposure with no red flags; ",
            "MEDIUM=unlimited approval to verified/no-warning spender; ",
            "HIGH=unknown/unverified/proxy/weak-facts spender or unusual approval pattern; ",
            "CRITICAL=known scam/phishing/drainer or explicit malicious finding.",
            "\nReturn exactly TRUSTED_LOW, LOW, MEDIUM, HIGH, or CRITICAL."
        );
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
