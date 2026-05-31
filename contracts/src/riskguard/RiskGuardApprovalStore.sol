// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title RiskGuardApprovalStore
 * @notice On-chain store for Agent approvals.
 *
 * Approval lifecycle:
 * 1. Hook rejects a guarded tx with PendingApprovalRequired revert data.
 * 2. Agent observes failed simulation/UserOp revert data and sends Telegram.
 * 3. User approves; Agent calls submitApproval(smartAccount, txHash).
 * 4. User resubmits; Hook finds approval and allows execution.
 * 5. Hook consumes the approval after successful execution.
 */
contract RiskGuardApprovalStore {
    uint256 public constant APPROVAL_TTL = 10 minutes;

    struct Approval {
        bool exists;
        uint256 expiry;
        bytes32 txHash;
    }

    /// @notice smartAccount => pending approval
    mapping(address => Approval) public pendingApprovals;

    /// @notice smartAccount => agent address allowed to submit approvals
    mapping(address => address) public registeredAgent;

    /// @notice smartAccount => hook module allowed to consume approvals
    mapping(address => address) public registeredHook;

    error NotRegisteredAgent();
    error NotRegisteredHook();
    error ZeroAddress();
    error ApprovalExpired();
    error NoApproval();
    error TxHashMismatch();

    event AgentRegistered(address indexed smartAccount, address indexed agent);
    event HookRegistered(address indexed smartAccount, address indexed hook);
    event ApprovalSubmitted(address indexed smartAccount, bytes32 indexed txHash, uint256 expiry);
    event ApprovalConsumed(address indexed smartAccount, bytes32 indexed txHash);
    event ApprovalExpiredCleared(address indexed smartAccount, bytes32 indexed txHash);

    /**
     * @notice Register the Agent address allowed to submit approvals for this account.
     *         Called by the smart account itself during module setup.
     */
    function registerAgent(address agent) external {
        if (agent == address(0)) revert ZeroAddress();
        registeredAgent[msg.sender] = agent;
        emit AgentRegistered(msg.sender, agent);
    }

    /**
     * @notice Register the Hook module allowed to consume approvals for this account.
     *         Called by the smart account itself during module setup.
     */
    function registerHook(address hook) external {
        if (hook == address(0)) revert ZeroAddress();
        registeredHook[msg.sender] = hook;
        emit HookRegistered(msg.sender, hook);
    }

    /**
     * @notice Convenience setup for the common install flow.
     *         The smart account should call this with its Agent and installed Hook module.
     */
    function registerAgentAndHook(address agent, address hook) external {
        if (agent == address(0) || hook == address(0)) revert ZeroAddress();

        registeredAgent[msg.sender] = agent;
        registeredHook[msg.sender] = hook;

        emit AgentRegistered(msg.sender, agent);
        emit HookRegistered(msg.sender, hook);
    }

    /**
     * @notice Called by Somnia Agent after user approves via Telegram.
     * @param smartAccount The account whose tx was approved.
     * @param txHash keccak256(callData) of the approved tx.
     */
    function submitApproval(address smartAccount, bytes32 txHash) external {
        if (msg.sender != registeredAgent[smartAccount]) revert NotRegisteredAgent();

        uint256 expiry = block.timestamp + APPROVAL_TTL;
        pendingApprovals[smartAccount] = Approval({ exists: true, expiry: expiry, txHash: txHash });

        emit ApprovalSubmitted(smartAccount, txHash, expiry);
    }

    /**
     * @notice Called by the registered RiskGuardHookModule after successful execution.
     *         Deletes the matching approval so it cannot be reused.
     */
    function consumeApproval(address smartAccount, bytes32 txHash) external {
        if (msg.sender != registeredHook[smartAccount]) revert NotRegisteredHook();

        Approval storage approval = pendingApprovals[smartAccount];
        if (!approval.exists) revert NoApproval();
        if (approval.txHash != txHash) revert TxHashMismatch();

        delete pendingApprovals[smartAccount];
        emit ApprovalConsumed(smartAccount, txHash);
    }

    /**
     * @notice Check if a valid, non-expired approval exists for a specific txHash.
     */
    function hasValidApproval(address smartAccount, bytes32 txHash) external view returns (bool) {
        Approval storage approval = pendingApprovals[smartAccount];
        return approval.exists && approval.txHash == txHash && block.timestamp <= approval.expiry;
    }

    function getApproval(address smartAccount) external view returns (Approval memory) {
        return pendingApprovals[smartAccount];
    }
}
