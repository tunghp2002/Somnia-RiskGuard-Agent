import { z } from "zod";

export const sessionKeyActionSchema = z.enum(["checkin", "send", "swap", "riskguard-approval"]);
export type SessionKeyAction = z.infer<typeof sessionKeyActionSchema>;

export interface SessionKeyActionPermission {
  action: SessionKeyAction;
  walletAddress: string;
  smartAccountAddress?: string;
  sessionKeyAddress: string;
  approvedTargets: string[];
  nativeTokenLimitPerTransaction: string;
  permissionStartTimestamp: string;
  permissionEndTimestamp: string;
}

export interface ThirdwebSessionKeyPermissions {
  approvedTargets: string[];
  nativeTokenLimitPerTransaction: string;
  permissionStartTimestamp: Date;
  permissionEndTimestamp: Date;
}

const permanentPermissionEnd = "9999-12-31T23:59:59.000Z";

export function getSessionKeyActionTargets(input: {
  action: SessionKeyAction;
  inheritanceRegistryAddress?: string;
  riskGuardApprovalStoreAddress?: string;
}): string[] {
  if (input.action === "checkin") {
    if (!input.inheritanceRegistryAddress) {
      throw new Error("Inheritance Registry is not deployed/configured for this chain yet.");
    }

    return [input.inheritanceRegistryAddress];
  }

  if (input.action === "riskguard-approval") {
    if (!input.riskGuardApprovalStoreAddress) {
      throw new Error("RiskGuard ApprovalStore is not deployed/configured for this chain yet.");
    }

    return [input.riskGuardApprovalStoreAddress];
  }

  throw new Error(`Session-key action ${input.action} is not configured yet.`);
}

export function toSessionKeyActionPermission(input: {
  action: SessionKeyAction;
  walletAddress: string;
  smartAccountAddress?: string;
  sessionKeyAddress: string;
  approvedTargets: string[];
}): SessionKeyActionPermission {
  return {
    action: input.action,
    walletAddress: input.walletAddress,
    ...(input.smartAccountAddress ? { smartAccountAddress: input.smartAccountAddress } : {}),
    sessionKeyAddress: input.sessionKeyAddress,
    approvedTargets: input.approvedTargets,
    nativeTokenLimitPerTransaction: "0",
    permissionStartTimestamp: new Date(0).toISOString(),
    permissionEndTimestamp: permanentPermissionEnd
  };
}

export function toThirdwebSessionKeyPermissions(
  permission: Pick<
    SessionKeyActionPermission,
    | "approvedTargets"
    | "nativeTokenLimitPerTransaction"
    | "permissionStartTimestamp"
    | "permissionEndTimestamp"
  >
): ThirdwebSessionKeyPermissions {
  return {
    approvedTargets: permission.approvedTargets,
    nativeTokenLimitPerTransaction: permission.nativeTokenLimitPerTransaction,
    permissionStartTimestamp: new Date(permission.permissionStartTimestamp),
    permissionEndTimestamp: new Date(permission.permissionEndTimestamp)
  };
}
