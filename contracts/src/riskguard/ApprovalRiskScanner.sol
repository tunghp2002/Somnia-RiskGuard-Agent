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
        uint256 itemCount;
        uint256 completedCount;
        bool exists;
    }

    struct RequestRef {
        uint256 scanId;
        uint256 itemIndex;
        Stage stage;
        bool exists;
    }

    mapping(uint256 => Scan) public scans;
    mapping(uint256 => mapping(uint256 => ItemState)) internal _items;
    mapping(uint256 => RequestRef) public requestRef;

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
            escrow: required,
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

        // Refund any overpayment immediately so escrow exactly matches reserved agent calls.
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
        (uint256 scanId, uint256 itemIndex) = _consumeRequest(requestId, Stage.JsonApi);
        (string memory decoded, bool ok) = _decodeString(responses, status);
        _onStageReturn(scanId, itemIndex, Stage.JsonApi, decoded, ok);
    }

    function handleParseWebsiteResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external nonReentrant {
        (uint256 scanId, uint256 itemIndex) = _consumeRequest(requestId, Stage.ParseWebsite);
        (string memory decoded, bool ok) = _decodeString(responses, status);
        _onStageReturn(scanId, itemIndex, Stage.ParseWebsite, decoded, ok);
    }

    function handleInferenceResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external nonReentrant {
        (uint256 scanId, uint256 itemIndex) = _consumeRequest(requestId, Stage.Inference);
        ItemState storage state = _items[scanId][itemIndex];
        if (state.status == ItemStatus.Complete) return;

        (string memory decoded, bool ok) = _decodeString(responses, status);
        uint8 score;
        string memory verdict;
        if (ok) {
            (score, verdict) = _parseScore(decoded);
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
        Scan storage scan = scans[scanId];
        scan.escrow -= deposit;
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchString.selector, item.explorerApiUrl, item.explorerApiSelector
        );
        uint256 requestId = agentPlatform.createRequest{ value: deposit }(
            jsonApiAgentId, address(this), this.handleJsonApiResponse.selector, payload
        );
        requestRef[requestId] = RequestRef(scanId, i, Stage.JsonApi, true);
        emit ItemStageRequested(scanId, i, Stage.JsonApi, requestId);
    }

    function _fireParseWebsite(
        uint256 scanId,
        uint256 i,
        ApprovalItem calldata item,
        uint256 deposit
    ) private {
        Scan storage scan = scans[scanId];
        scan.escrow -= deposit;
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
        requestRef[requestId] = RequestRef(scanId, i, Stage.ParseWebsite, true);
        emit ItemStageRequested(scanId, i, Stage.ParseWebsite, requestId);
    }

    function _fireInference(uint256 scanId, uint256 i) private {
        ItemState storage state = _items[scanId][i];
        Scan storage scan = scans[scanId];

        // CEI: flip guards and draw escrow before the external createRequest call.
        state.inferenceFired = true;
        state.status = ItemStatus.Inferring;
        uint256 deposit = _agentDeposit();
        scan.escrow -= deposit;

        string[] memory allowedValues = new string[](0);
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
        requestRef[requestId] = RequestRef(scanId, i, Stage.Inference, true);
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
            state.jsonFacts = decoded;
        } else {
            if (state.webReturned) return;
            state.webReturned = true;
            state.webFindings = decoded;
        }
        emit ItemStageReturned(scanId, i, stage, ok);

        if (state.jsonReturned && state.webReturned && !state.inferenceFired) {
            _fireInference(scanId, i);
        }
    }

    // --- internal: helpers -------------------------------------------------------------------

    function _consumeRequest(uint256 requestId, Stage expected)
        private
        returns (uint256 scanId, uint256 itemIndex)
    {
        if (msg.sender != address(agentPlatform)) revert OnlyAgentPlatform();
        RequestRef memory ref = requestRef[requestId];
        if (!ref.exists || ref.stage != expected) revert UnknownAgentRequest();
        delete requestRef[requestId];
        return (ref.scanId, ref.itemIndex);
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
            "Reply with exactly one line in the form NN|verdict where NN is an integer 0-100 ",
            "(0 safest, 100 most dangerous) and verdict is a short phrase. ",
            "Treat unlimited allowances, unverified contracts, proxies and scam reports as higher risk."
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
            "\nReturn NN|verdict."
        );
    }

    function _parseScore(string memory raw) internal pure returns (uint8 score, string memory verdict) {
        bytes memory data = bytes(raw);
        uint256 i;
        uint256 value;
        bool sawDigit;
        // Skip leading non-digits, then read the first integer.
        while (i < data.length && (data[i] < 0x30 || data[i] > 0x39)) {
            i++;
        }
        while (i < data.length && data[i] >= 0x30 && data[i] <= 0x39) {
            sawDigit = true;
            value = value * 10 + (uint8(data[i]) - 0x30);
            if (value > 100) {
                value = 100;
            }
            i++;
        }
        score = sawDigit ? uint8(value) : 50;

        // Use the text after a '|' separator as the verdict, else the whole string.
        uint256 sep = data.length;
        for (uint256 j; j < data.length; ++j) {
            if (data[j] == 0x7C) {
                sep = j + 1;
                break;
            }
        }
        if (sep < data.length) {
            bytes memory out = new bytes(data.length - sep);
            for (uint256 k; k < out.length; ++k) {
                out[k] = data[sep + k];
            }
            verdict = string(out);
        } else {
            verdict = raw;
        }
    }
}
