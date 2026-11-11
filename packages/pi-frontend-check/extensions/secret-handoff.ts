import {
	SECRET_HANDLE_PATTERN,
	SECRET_HANDOFF_KEY,
} from '../../../security/secret-handoff.ts'

import type {
	ClaimFailure,
	SecretHandoff,
} from '../../../security/secret-handoff.ts'

export { SECRET_HANDLE_PATTERN }

export interface BoundSecret {
	value: string
	origin: string
}

const CLAIM_FAILURES: Record<ClaimFailure, string> = {
	unknown:
		'Unknown or already used secret handle; request a new one with ask_user_secret.',
	expired: 'Secret handle expired; request a new one with ask_user_secret.',
	origin: 'Secret handle is bound to another origin; nothing was filled.',
}

function isHandoff(candidate: unknown): candidate is SecretHandoff {
	return (
		typeof candidate === 'object' &&
		candidate !== null &&
		typeof Reflect.get(candidate, 'claim') === 'function'
	)
}

function registry(): SecretHandoff {
	const found: unknown = Reflect.get(globalThis, SECRET_HANDOFF_KEY)
	if (isHandoff(found)) return found
	throw new Error(
		'ask_user_secret is not loaded; no secret handle can be claimed.',
	)
}

/** One-time claim of a handle for the origin the page currently reports. */
export function claimSecret(handle: string, origin: string): BoundSecret {
	const outcome = registry().claim(handle, origin)
	if (!outcome.ok) throw new Error(CLAIM_FAILURES[outcome.reason])
	return { value: outcome.value, origin }
}
