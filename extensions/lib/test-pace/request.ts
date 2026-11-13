import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { readRelay } from '#lib/hc-relay.ts'

import { redactSecrets } from '../../../security/secret-redact.ts'

import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type { Static } from 'typebox'

export const PACE_REQUEST_ENTRY = 'test-pace-request-v1'
export const PACE_GRANT_ENTRY = 'test-pace-grant-v1'
export const PACE_CREATED_ENTRY = 'test-pace-created-v1'
export const PACE_DECISION_ENTRY = 'test-pace-decision-v1'

/** `delegated`: a parent agent wrote it for a subagent. `relay`: another terminal typed it with `hc send`. */
const ORIGIN_SCHEMA = Type.Union([
	Type.Object({ kind: Type.Literal('human') }),
	Type.Object({ kind: Type.Literal('delegated') }),
	Type.Object({
		kind: Type.Literal('relay'),
		sender: Type.Optional(Type.String()),
	}),
])
const REQUEST_SCHEMA = Type.Object({
	id: Type.String(),
	text: Type.String(),
	origin: ORIGIN_SCHEMA,
})

type RequestOrigin = Static<typeof ORIGIN_SCHEMA>
export type PaceRequest = Static<typeof REQUEST_SCHEMA>

export function readPaceRequest(candidate: unknown): PaceRequest | undefined {
	if (!Value.Check(REQUEST_SCHEMA, candidate)) return undefined
	return candidate
}

export function typedOrigin(typed: string): RequestOrigin {
	const relay = readRelay(typed)
	if (!relay) return { kind: 'human' }
	return relay.sender
		? { kind: 'relay', sender: relay.sender }
		: { kind: 'relay' }
}

export function currentPaceRequest(
	entries: readonly SessionEntry[],
): PaceRequest | undefined {
	const saved = entries.findLast(
		entry =>
			entry.type === 'custom' && entry.customType === PACE_REQUEST_ENTRY,
	)
	if (saved?.type !== 'custom') return undefined
	return readPaceRequest(saved.data)
}

function recordedPaths(
	entries: readonly SessionEntry[],
	customType: string,
	requestId?: string,
): string[] {
	return entries.flatMap(entry => {
		if (entry.type !== 'custom' || entry.customType !== customType)
			return []
		const receipt = Object(entry.data)
		if (requestId && Reflect.get(receipt, 'requestId') !== requestId)
			return []
		const paths: unknown = Reflect.get(receipt, 'paths')
		return Array.isArray(paths)
			? paths.filter(
					(path: unknown): path is string => typeof path === 'string',
				)
			: []
	})
}

export function createdTestPaths(entries: readonly SessionEntry[]): string[] {
	return recordedPaths(entries, PACE_CREATED_ENTRY)
}

export function grantedTestPaths(
	entries: readonly SessionEntry[],
	requestId: string,
): string[] {
	return recordedPaths(entries, PACE_GRANT_ENTRY, requestId)
}

export function safePaceText(text: string): string {
	return redactSecrets(text)
		.replace(
			/<file\b[^>]*>[\s\S]*?(?:<\/file>|$)/gi,
			'[Attached file omitted]',
		)
		.replace(/```[\s\S]*?(?:```|$)/g, '[Code omitted]')
		.replace(
			/\b(?:password|token|secret|api[_ -]?key|mot de passe)\s*[:=]\s*\S+/gi,
			'[REDACTED]',
		)
}

export function forbidsTestAuthoring(text: string): boolean {
	return /\b(?:do not|don't|never|no|without|pas|jamais|sans)\s+(?:(?:writing|adding|creating|editing|write|add|create|edit|update|modify|delete|remove|écrire|ecrire|ajouter|modifier|des|de|les|the|any|new|existing|unit|regression)\s+)*tests?\b|\btests?\s+(?:are\s+)?(?:forbidden|banned|not authorized)\b/i.test(
		text,
	)
}
