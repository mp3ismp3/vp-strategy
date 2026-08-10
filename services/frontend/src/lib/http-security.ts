type AppUrlEnv = {
  NODE_ENV?: string;
  NEXT_PUBLIC_APP_URL?: string;
};

export class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
  }
}

export function getCanonicalAppUrl(env: AppUrlEnv = process.env): string {
  const configured = env.NEXT_PUBLIC_APP_URL;
  if (!configured) throw new Error("Missing NEXT_PUBLIC_APP_URL");
  const url = new URL(configured);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("NEXT_PUBLIC_APP_URL must be an origin only");
  }
  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_APP_URL must use HTTPS in production");
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error("NEXT_PUBLIC_APP_URL must use HTTP or HTTPS");
  }
  return url.origin;
}

export function isTrustedMutationRequest(
  request: Request | undefined,
  env: AppUrlEnv = process.env
): boolean {
  if (!request) return env.NODE_ENV !== "production";
  let canonicalOrigin: string;
  try {
    canonicalOrigin = getCanonicalAppUrl(env);
  } catch {
    return false;
  }
  const origin = request.headers.get("origin");
  if (origin) return origin === canonicalOrigin;
  // Non-production tests and local CLI clients may omit Origin. Production
  // cookie-authenticated mutations must always carry the browser Origin.
  return env.NODE_ENV !== "production" && new URL(request.url).origin === canonicalOrigin;
}

export function isJsonRequest(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  if (!contentType) return process.env.NODE_ENV !== "production";
  return contentType.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

export async function readRequestBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new PayloadTooLargeError();
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
}
