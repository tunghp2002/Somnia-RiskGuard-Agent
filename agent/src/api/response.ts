import type { ServerResponse } from "node:http";

export interface ApiSuccess<T> {
  data: T;
  meta: {
    requestId?: string;
  };
}

export interface ApiFailure {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function sendJson<T>(
  response: ServerResponse,
  statusCode: number,
  payload: ApiSuccess<T> | ApiFailure
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

export function success<T>(data: T, requestId?: string): ApiSuccess<T> {
  return {
    data,
    meta: {
      ...(requestId ? { requestId } : {})
    }
  };
}

export function failure(
  code: string,
  message: string,
  details?: unknown
): ApiFailure {
  return {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details })
    }
  };
}
