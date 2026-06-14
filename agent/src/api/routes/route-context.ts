import type { IncomingMessage, ServerResponse } from "node:http";

import type { AgentApiDependencies } from "../dependencies.js";
import type { TelegramConnectService } from "../../services/telegram-connect.service.js";

export interface ApiRouteContext {
  dependencies: AgentApiDependencies;
  telegramConnect: TelegramConnectService | undefined;
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  requestId: string;
}
