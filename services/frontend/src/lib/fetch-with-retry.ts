/**
 * fetch wrapper，自動處理 429 Rate Limit 回應：
 * - 指數退避重試
 * - 尊重 Retry-After header
 * - 暴露 rate limit 狀態給呼叫端
 */

export interface FetchWithRetryOptions extends RequestInit {
  /** 最大重試次數（預設 2） */
  maxRetries?: number;
  /** 收到 429 時的回呼（可用於顯示 toast 提示） */
  onRateLimited?: (retryAfter: number, attempt: number) => void;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

/**
 * 從 response headers 解析 rate limit 資訊
 */
export function parseRateLimitHeaders(response: Response): RateLimitInfo | null {
  const limit = response.headers.get("X-RateLimit-Limit");
  const remaining = response.headers.get("X-RateLimit-Remaining");
  const reset = response.headers.get("X-RateLimit-Reset");

  if (!limit || !remaining || !reset) return null;

  return {
    limit: parseInt(limit, 10),
    remaining: parseInt(remaining, 10),
    reset: parseInt(reset, 10),
  };
}

/**
 * 自動處理 429 的 fetch wrapper
 *
 * @example
 * ```ts
 * const res = await fetchWithRetry('/api/data/scan-results', {
 *   maxRetries: 2,
 *   onRateLimited: (seconds) => {
 *     toast.warning(`請求過於頻繁，${seconds} 秒後重試...`);
 *   },
 * });
 * ```
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const { maxRetries = 2, onRateLimited, ...fetchOptions } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, fetchOptions);

    if (response.status !== 429) {
      return response;
    }

    // 被 rate limit 了
    const retryAfterHeader = response.headers.get("Retry-After");
    const retryAfter = retryAfterHeader
      ? parseInt(retryAfterHeader, 10)
      : Math.min(2 ** attempt * 2, 30); // 指數退避：2s, 4s, 8s... 最多 30s

    // 通知呼叫端
    if (onRateLimited) {
      onRateLimited(retryAfter, attempt + 1);
    }

    // 最後一次重試失敗就直接回傳 429 response
    if (attempt >= maxRetries) {
      return response;
    }

    // 等待後重試
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
  }

  // 不應到達這裡，但 TypeScript 需要
  throw new Error("Unexpected: exceeded retry loop");
}

/**
 * React hook 用的 rate limit 狀態管理
 *
 * @example
 * ```tsx
 * const [rateLimitState, setRateLimitState] = useState<RateLimitState>({ isLimited: false });
 *
 * const res = await fetchWithRetry('/api/data', {
 *   onRateLimited: (seconds) => {
 *     setRateLimitState({ isLimited: true, retryAfter: seconds });
 *   },
 * });
 *
 * if (res.ok) {
 *   setRateLimitState({ isLimited: false });
 * }
 * ```
 */
export interface RateLimitState {
  isLimited: boolean;
  retryAfter?: number;
  message?: string;
}

/**
 * 產生使用者友善的 rate limit 訊息
 */
export function getRateLimitMessage(retryAfter: number): string {
  if (retryAfter <= 5) {
    return "請求過於頻繁，請稍候...";
  }
  if (retryAfter <= 30) {
    return `操作太頻繁，請等待 ${retryAfter} 秒後再試。`;
  }
  return `請求已被限制，請在 ${Math.ceil(retryAfter / 60)} 分鐘後再試。`;
}
