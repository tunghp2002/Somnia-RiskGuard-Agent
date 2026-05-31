import { Wallet, getAddress } from "ethers";

import type { AgentConfig } from "../config/env.js";
import type { SessionKeyRecord, SessionKeysRepository } from "../persistence/session-keys.repository.js";
import { decryptSecret, encryptSecret } from "./session-key-crypto.js";
import {
  getSessionKeyActionTargets,
  toSessionKeyActionPermission,
  type SessionKeyAction,
  type SessionKeyActionPermission
} from "./session-key-actions.js";

export class SessionKeyService {
  public constructor(
    private readonly config: AgentConfig,
    private readonly repository: SessionKeysRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  public ready() {
    return true;
  }

  public async ensurePermission(input: {
    walletAddress: string;
    smartAccountAddress?: string;
    action: SessionKeyAction;
  }): Promise<SessionKeyActionPermission> {
    const repository = this.requireRepository();
    const walletAddress = getAddress(input.walletAddress);
    const smartAccountAddress = input.smartAccountAddress ? getAddress(input.smartAccountAddress) : undefined;
    const action = input.action;
    const approvedTargets = getSessionKeyActionTargets({
      action,
      ...(this.config.publicChain.contracts.inheritanceRegistry
        ? { inheritanceRegistryAddress: this.config.publicChain.contracts.inheritanceRegistry }
        : {}),
      ...(this.config.publicChain.contracts.riskGuardApprovalStore
        ? { riskGuardApprovalStoreAddress: this.config.publicChain.contracts.riskGuardApprovalStore }
        : {})
    });
    const existing = await repository.findForGrant({
      walletAddress,
      ...(smartAccountAddress ? { smartAccountAddress } : {}),
      action
    });
    const record = existing
      ? smartAccountAddress && existing.smartAccountAddress !== smartAccountAddress
        ? await repository.upsert({
          walletAddress,
          smartAccountAddress,
          action,
          sessionKeyAddress: existing.sessionKeyAddress,
          encryptedPrivateKey: existing.encryptedPrivateKey,
          encryptionIv: existing.encryptionIv,
          encryptionTag: existing.encryptionTag,
          status: "active"
        })
        : existing
      : await this.createRecord(walletAddress, action, smartAccountAddress);

    return toSessionKeyActionPermission({
      action,
      walletAddress: record.walletAddress,
      ...(record.smartAccountAddress ? { smartAccountAddress: record.smartAccountAddress } : {}),
      sessionKeyAddress: record.sessionKeyAddress,
      approvedTargets
    });
  }

  public async getPrivateKeyForSmartAccount(
    smartAccountAddress: string,
    action: SessionKeyAction
  ): Promise<{ record: SessionKeyRecord; privateKey: string }> {
    const repository = this.requireRepository();
    const encryptionKey = this.requireEncryptionKey();
    const record = await repository.findActiveBySmartAccount(getAddress(smartAccountAddress), action);

    if (!record) {
      throw new Error(`No active ${action} session key is registered for this smart account.`);
    }

    return {
      record,
      privateKey: decryptSecret({
        ciphertext: record.encryptedPrivateKey,
        iv: record.encryptionIv,
        tag: record.encryptionTag
      }, encryptionKey)
    };
  }

  public markUsed(sessionKeyId: string) {
    return this.requireRepository().markUsed(sessionKeyId, this.now().toISOString());
  }

  private async createRecord(
    walletAddress: string,
    action: SessionKeyAction,
    smartAccountAddress?: string
  ) {
    const wallet = Wallet.createRandom();
    const encrypted = encryptSecret(wallet.privateKey, this.requireEncryptionKey());

    return this.requireRepository().upsert({
      walletAddress,
      ...(smartAccountAddress ? { smartAccountAddress } : {}),
      action,
      sessionKeyAddress: wallet.address,
      encryptedPrivateKey: encrypted.ciphertext,
      encryptionIv: encrypted.iv,
      encryptionTag: encrypted.tag,
      status: smartAccountAddress ? "active" : "pending"
    });
  }

  private requireRepository() {
    return this.repository;
  }

  private requireEncryptionKey() {
    return this.config.supabase.sessionKeyEncryptionKey;
  }
}
