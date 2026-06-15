import { formatUnits } from "ethers";

export function summarizeReason(explanation: string): string {
  return explanation.length > 240 ? `${explanation.slice(0, 237)}...` : explanation;
}

export function formatAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatNativeValue(valueWei: string): string {
  try {
    const formatted = formatUnits(valueWei, 18);
    const [whole, fraction = ""] = formatted.split(".");
    const trimmedFraction = fraction.slice(0, 6).replace(/0+$/, "");

    return `${whole}${trimmedFraction ? `.${trimmedFraction}` : ""} STT`;
  } catch {
    return `${valueWei} wei`;
  }
}

export function stripAgentRecommendationPrefix(reason: string): string {
  return reason
    .replace(/^\s*APPROVE\s*:?\s*/i, "")
    .replace(/^\s*REJECT\s*:?\s*/i, "")
    .trim();
}

export function summarizeRiskGuardApprovalFailure(reason: string): string {
  if (/account does not exist|insufficient funds|no STT for gas/i.test(reason)) {
    return "RiskGuard approval signer does not have enough STT for gas. Reconfigure Risk Policy Guard so the user smart account funds the approval signer, then request review again.";
  }

  if (/not registered/i.test(reason)) {
    return "RiskGuard approval signer is not registered for this smart account. Reconfigure Risk Policy Guard, then request review again.";
  }

  return reason.length > 240 ? `${reason.slice(0, 237)}...` : reason;
}
