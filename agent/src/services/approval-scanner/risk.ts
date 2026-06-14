import type { ApprovalEntry, ScanItemStatus, ScanStatus } from "./types.js";

interface PreparedScanItem {
  chainId: number;
  spender: string;
  token: string;
  context: string;
}

export function normalizeScanItems(items: ScanItemStatus[]): ScanItemStatus[] {
  const spenderCounts = new Map<string, number>();
  for (const item of items) {
    const spender = item.spender.toLowerCase();
    spenderCounts.set(spender, (spenderCounts.get(spender) ?? 0) + 1);
  }

  return items.map((item) => {
    const deterministic = classifyContextRisk(
      item.context,
      spenderCounts.get(item.spender.toLowerCase()) ?? 1
    );
    const needsDeterministicRisk = /INFERENCE_FAILED|UNKNOWN/i.test(item.verdict)
      || /batch inference failed/i.test(item.webFindings);
    return {
      ...item,
      riskScore: needsDeterministicRisk ? deterministic.riskScore : item.riskScore,
      verdict: needsDeterministicRisk ? deterministic.verdict : item.verdict,
      jsonFacts: isUnavailableFact(item.jsonFacts)
        ? `Active approval context: ${item.context}`
        : item.jsonFacts,
      webFindings: isUnavailableFinding(item.webFindings)
        ? deterministic.batchNotes
        : item.webFindings
    };
  });
}

export function buildLocalBatchStatus(
  requester: string,
  approvals: ApprovalEntry[],
  items: PreparedScanItem[]
): ScanStatus {
  const spenderCounts = new Map<string, number>();
  for (const approval of approvals) {
    const spender = approval.spender.toLowerCase();
    spenderCounts.set(spender, (spenderCounts.get(spender) ?? 0) + 1);
  }

  return {
    scanId: 0,
    requester,
    itemCount: approvals.length,
    completedCount: approvals.length,
    complete: true,
    items: approvals.map((approval, index) => {
      const analysis = classifyApprovalRisk(
        approval,
        spenderCounts.get(approval.spender.toLowerCase()) ?? 1
      );
      const item = items[index];
      return {
        itemIndex: index,
        chainId: item?.chainId ?? approval.chainId,
        spender: item?.spender ?? approval.spender,
        token: item?.token ?? approval.token,
        context: item?.context ?? "",
        status: "complete",
        riskScore: analysis.riskScore,
        verdict: analysis.verdict,
        jsonFacts: analysis.onChainFacts,
        webFindings: analysis.batchNotes
      };
    })
  };
}

function isUnavailableFact(value: string): boolean {
  return !value.trim() || /source facts unavailable|Unavailable/i.test(value);
}

function isUnavailableFinding(value: string): boolean {
  return !value.trim()
    || /batch inference failed|website findings unavailable|review manually|Unavailable/i.test(value);
}

function classifyContextRisk(
  context: string,
  spenderExposureCount: number
): { riskScore: number; verdict: "LOW" | "MEDIUM" | "HIGH"; batchNotes: string } {
  const isNftOperator = /standard=erc721|standard=erc1155/i.test(context);
  const isUnlimited = /allowance=unlimited|allowance=all/i.test(context);
  const repeatedSpender = spenderExposureCount >= 3;
  const reasons: string[] = [];

  if (isNftOperator) {
    reasons.push("NFT operator approval can move collection assets");
  }
  if (isUnlimited) {
    reasons.push("unlimited allowance is active");
  }
  if (repeatedSpender) {
    reasons.push(`same spender appears on ${spenderExposureCount} active approvals`);
  }

  if (isNftOperator || (isUnlimited && repeatedSpender)) {
    return {
      riskScore: 80,
      verdict: "HIGH",
      batchNotes: reasons.join("; ")
    };
  }
  if (isUnlimited) {
    return {
      riskScore: 50,
      verdict: "MEDIUM",
      batchNotes: reasons.join("; ")
    };
  }
  return {
    riskScore: 20,
    verdict: "LOW",
    batchNotes: reasons.length > 0
      ? reasons.join("; ")
      : "limited approval with no repeated spender in this batch"
  };
}

function classifyApprovalRisk(
  approval: ApprovalEntry,
  spenderExposureCount: number
): {
  riskScore: number;
  verdict: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  onChainFacts: string;
  batchNotes: string;
} {
  const allowance = parseAllowance(approval.allowance);
  const isNftOperator = approval.standard === "erc721" || approval.standard === "erc1155";
  const isLargeLimitedAllowance = allowance !== null && allowance > 10n ** 24n;
  const repeatedSpender = spenderExposureCount >= 3;
  const reasons: string[] = [];

  if (isNftOperator) {
    reasons.push("operator approval can move collection assets");
  }
  if (approval.isUnlimited) {
    reasons.push("unlimited allowance");
  }
  if (isLargeLimitedAllowance) {
    reasons.push("large active allowance");
  }
  if (repeatedSpender) {
    reasons.push(`same spender appears on ${spenderExposureCount} approvals in this scan`);
  }

  let verdict: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "LOW";
  if (isNftOperator || (repeatedSpender && (approval.isUnlimited || isLargeLimitedAllowance))) {
    verdict = "HIGH";
  } else if (approval.isUnlimited || isLargeLimitedAllowance) {
    verdict = "MEDIUM";
  }

  const riskScore = verdict === "HIGH" ? 80 : verdict === "MEDIUM" ? 50 : 20;
  const allowanceLabel = approval.isUnlimited ? "unlimited" : approval.allowance || "active";
  const onChainFacts = `${approval.standard.toUpperCase()} approval is active on ${
    approval.chainName
  }: ${allowanceLabel} ${approval.symbol || "TOKEN"} allowance to ${approval.spender}.`;
  const batchNotes = reasons.length > 0
    ? reasons.join("; ")
    : "limited approval with no repeated spender in this batch";

  return {
    riskScore,
    verdict,
    onChainFacts,
    batchNotes
  };
}

function parseAllowance(value: string): bigint | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}
