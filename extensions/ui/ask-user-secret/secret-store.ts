import { randomBytes } from 'node:crypto'

import {
	SECRET_HANDLE_TTL_MS,
	SECRET_HANDOFF_KEY,
} from '../../../security/secret-handoff.ts'

import type {
	ClaimResult,
	SecretHandoff,
} from '../../../security/secret-handoff.ts'

interface Parked {
	value: string
	origin: string
	expiresAt: number
}

const HANDLE_BYTES = 16

class InProcessHandoff implements SecretHandoff {
	private readonly parked = new Map<string, Parked>()

	issue(
		secretValue: string,
		origin: string,
	): { handle: string; expiresAt: number } {
		this.sweep()
		const handle = `sec:${randomBytes(HANDLE_BYTES).toString('base64url')}`
		const expiresAt = Date.now() + SECRET_HANDLE_TTL_MS
		this.parked.set(handle, { value: secretValue, origin, expiresAt })
		return { handle, expiresAt }
	}

	claim(handle: string, origin: string): ClaimResult {
		const entry = this.parked.get(handle)
		if (!entry) return { ok: false, reason: 'unknown' }
		// A claim is terminal whatever its outcome: a wrong origin burns the handle.
		this.parked.delete(handle)
		if (entry.expiresAt <= Date.now())
			return { ok: false, reason: 'expired' }
		if (entry.origin !== origin) return { ok: false, reason: 'origin' }
		return { ok: true, value: entry.value }
	}

	private sweep(): void {
		const now = Date.now()
		for (const [handle, entry] of this.parked)
			if (entry.expiresAt <= now) this.parked.delete(handle)
	}
}

function isHandoff(candidate: unknown): candidate is SecretHandoff {
	return (
		typeof candidate === 'object' &&
		candidate !== null &&
		typeof Reflect.get(candidate, 'issue') === 'function' &&
		typeof Reflect.get(candidate, 'claim') === 'function'
	)
}

/** The process-wide registry, created once and kept across /reload. */
export function secretHandoff(): SecretHandoff {
	const existing: unknown = Reflect.get(globalThis, SECRET_HANDOFF_KEY)
	if (isHandoff(existing)) return existing
	const created = new InProcessHandoff()
	Object.defineProperty(globalThis, SECRET_HANDOFF_KEY, {
		value: created,
		enumerable: false,
		writable: false,
		configurable: false,
	})
	return created
}
