export type RateLimitDecision =
  | { action: "retry"; retryAfterMs: number }
  | { action: "fail"; reason: "too_many_retries" | "not_retryable" };

export type RateLimitPolicyInput = {
  attempt: number; 
  maxAttempts: number;
  retryAfterMs?: number | null; 
  baseBackoffMs?: number; 
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export const RateLimitPolicy = {
  decide(input: RateLimitPolicyInput): RateLimitDecision {
    const maxAttempts = Math.max(1, Math.floor(input.maxAttempts));
    const attempt = Math.max(1, Math.floor(input.attempt));

    if (attempt >= maxAttempts) {
      return { action: "fail", reason: "too_many_retries" };
    }

    if (typeof input.retryAfterMs === "number" && Number.isFinite(input.retryAfterMs)) {
      const ms = clamp(Math.floor(input.retryAfterMs), 250, 60_000);
      return { action: "retry", retryAfterMs: ms };
    }

    const base = Number.isFinite(input.baseBackoffMs ?? 0) ? Number(input.baseBackoffMs) : 500;
    const backoff = clamp(Math.floor(base * Math.pow(2, attempt - 1)), 250, 30_000);
    return { action: "retry", retryAfterMs: backoff };
  },
};
