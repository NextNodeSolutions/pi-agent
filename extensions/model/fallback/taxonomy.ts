// Provider errors receive bounded recovery regardless of their wording.
// Context overflow is the exception. Pure, no state.
//
// Context overflow is deliberately NOT retryable: the input was too large for
// the model's window, so pi routes it to compaction and no other model helps.
// A bounded same-model retry handles transient evidence (`failover-fast`,
// `failover-slow`, `retryable`) before the chain cascade starts. A
// deterministic account-state refusal (402, insufficient balance, exhausted
// usage limit) is cascade evidence too, but without a same-model retry: the
// provider repeats it unchanged (see `isDeterministicFailure`). So does a turn
// Anthropic refuses as a third-party app's, where a retry may also draw from
// the account's extra usage.

export type HttpFailureClass = 'failover-fast' | 'failover-slow' | 'none'
export type FailureTextClass = 'retryable' | 'overflow'

const NOT_FOUND = 404
const REQUEST_TIMEOUT = 408
const TOO_MANY_REQUESTS = 429
const SERVER_ERROR_MIN = 500
const SERVER_ERROR_MAX = 599

/** Rate limit, timeout, missing model: transient like the 5xxs, for the budget. */
const SLOW_FAILURE_STATUSES = new Set([
	NOT_FOUND,
	REQUEST_TIMEOUT,
	TOO_MANY_REQUESTS,
])

/**
 * `failover-fast` marks an unhealthy provider endpoint (5xx): the bounded
 * retry budget may recover it in place. `failover-slow` (rate limit, timeout,
 * missing model) is transient evidence for the budget as well.
 */
export function classifyStatus(status: number): HttpFailureClass {
	if (status >= SERVER_ERROR_MIN && status <= SERVER_ERROR_MAX) {
		return 'failover-fast'
	}
	if (!SLOW_FAILURE_STATUSES.has(status)) return 'none'
	return 'failover-slow'
}

/**
 * Account-state failures (the HTTP 402 family, an exhausted usage limit): the
 * account answers every request the same way until its window or balance
 * returns, which is what earns the longer cooldown.
 */
const ACCOUNT_STATE_PATTERNS = [
	// A status-prefixed body (`402: {...}`, as pi surfaces it as the error
	// text) and the response-hook reason pi never builds here (`HTTP 402`).
	/^\s*402\s*:/,
	/\bHTTP\s402\b/,
	/insufficient\s+(?:balance|credit|funds)/i,
	/payment required/i,
	/usage limit/i,
]

/**
 * Anthropic's refusal of one turn it counts as a third-party app's ("out of
 * extra usage", "draw from your extra usage"): the same turn is refused
 * again, while the next one is often served on the plan.
 */
const REFUSED_TURN_PATTERNS = [/extra usage/i]

/** The account itself is spent: every request fails until it renews. */
export function isAccountStateFailure(reason: string): boolean {
	return ACCOUNT_STATE_PATTERNS.some(pattern => pattern.test(reason))
}

/** A failure the provider repeats unchanged: no retry, cascade right away. */
export function isDeterministicFailure(reason: string): boolean {
	return (
		isAccountStateFailure(reason) ||
		REFUSED_TURN_PATTERNS.some(pattern => pattern.test(reason))
	)
}

const OVERFLOW_PATTERNS = [
	/context(?: length| window| limit)? (?:exceed|overflow|too long)/i,
	/maximum context length/i,
	/too many tokens/i,
	/token limit/i,
	/context_length_exceeded/i,
	/length_required/i,
	/maximum.*tokens/i,
	/prompt.*too long/i,
	/input.*too long/i,
	/exceeded.*context/i,
	/context.*overflow/i,
]

/** Called only for a provider error; unfamiliar text still gets bounded recovery. */
export function classifyErrorText(text: string | undefined): FailureTextClass {
	if (text && OVERFLOW_PATTERNS.some(pattern => pattern.test(text)))
		return 'overflow'
	return 'retryable'
}

const RATE_LIMIT_PATTERNS = [
	/^\s*429\s*:/,
	/\bHTTP\s429\b/,
	/rate.?limit/i,
	/per.?minute/i,
	/too many requests/i,
	/near its capacity/i,
	/concurrent requests/i,
]

/** A provider throttle: the same model answers again once its window rolls, so the retry waits longer. */
export function isRateLimitFailure(reason: string): boolean {
	return RATE_LIMIT_PATTERNS.some(pattern => pattern.test(reason))
}
