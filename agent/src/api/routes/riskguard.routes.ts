import { ServerDependencyError, readJsonBody } from "../http-support.js";
import { sendJson, success } from "../response.js";
import type { ApiRouteContext } from "./route-context.js";
import { riskGuardPendingApprovalRequestSchema } from "../../services/riskguard/approval.service.js";
import { riskGuardPendingUserOpRequestSchema } from "../../services/riskguard/pending-userop.service.js";
import { riskGuardReviewBudgetRequestSchema } from "../../services/riskguard/review-budget.service.js";
import { riskGuardAgentReviewRequestedSchema } from "../../services/telegram-alert.service.js";

export async function handleRiskGuardRoutes(context: ApiRouteContext): Promise<boolean> {
  const { dependencies, request, response, url, requestId } = context;

  if (request.method === "POST" && url.pathname === "/api/riskguard/pending-approval") {
    if (!dependencies.telegramAlerts) {
      throw new ServerDependencyError("Telegram alert service is not configured");
    }
    const body = riskGuardPendingApprovalRequestSchema.parse(await readJsonBody(request));
    const result = await dependencies.telegramAlerts.sendRiskGuardApprovalRequest(body);
    sendJson(response, 202, success(result, requestId));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/riskguard/agent-review/requested") {
    if (!dependencies.telegramAlerts) {
      throw new ServerDependencyError("Telegram alert service is not configured");
    }
    const body = riskGuardAgentReviewRequestedSchema.parse(await readJsonBody(request));
    const result = await dependencies.telegramAlerts.sendRiskGuardAgentReviewRequested(body);
    sendJson(response, 202, success(result, requestId));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/riskguard/pending-userop") {
    if (!dependencies.riskGuardPendingUserOps) {
      throw new ServerDependencyError("RiskGuard pending UserOp service is not configured");
    }
    const body = riskGuardPendingUserOpRequestSchema.parse(await readJsonBody(request));
    const result = await dependencies.riskGuardPendingUserOps.store(body);
    sendJson(response, 202, success(result, requestId));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/riskguard/ensure-review-budget") {
    if (!dependencies.riskGuardReviewBudget) {
      throw new ServerDependencyError("RiskGuard review budget service is not configured");
    }
    const body = riskGuardReviewBudgetRequestSchema.parse(await readJsonBody(request));
    const result = await dependencies.riskGuardReviewBudget.ensureBudget(body);
    sendJson(response, 202, success(result, requestId));
    return true;
  }

  return false;
}
