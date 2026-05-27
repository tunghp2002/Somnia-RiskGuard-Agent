import { z } from "zod";

export const sessionKeyActionSchema = z.enum(["checkin", "send", "swap"]);
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

const permanentPermissionEnd = "9999-12-31T23:59:59.000Z";

export function getSessionKeyActionTargets(input: {
  action: SessionKeyAction;
  inheritanceRegistryAddress?: string;
}): string[] {
  if (input.action !== "checkin") {
    throw new Error(`Session-key action ${input.action} is not configured yet.`);
  }

  if (!input.inheritanceRegistryAddress) {
    throw new Error("Inheritance Registry is not deployed/configured for this chain yet.");
  }

  return [input.inheritanceRegistryAddress];
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
