import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

interface ApiErrorOptions {
  internalError?: unknown;
  retryAfter?: number;
}

export function apiError(
  code: string,
  message: string,
  status: number,
  options: ApiErrorOptions = {}
): NextResponse {
  const requestId = randomUUID();
  if (options.internalError !== undefined) {
    const errorType = options.internalError instanceof Error
      ? options.internalError.name
      : "UnknownError";
    console.error(`[api:${code}] requestId=${requestId} errorType=${errorType}`);
  }
  const headers = options.retryAfter
    ? { "Retry-After": String(options.retryAfter) }
    : undefined;
  return NextResponse.json({ error: { code, message, requestId } }, { status, headers });
}

export function serviceUnavailable(code: string, message: string, internalError?: unknown) {
  return apiError(code, message, 503, { internalError, retryAfter: 30 });
}
