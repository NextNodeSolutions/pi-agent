import { readRelay } from '#lib/hc-relay.ts'

import { redactSecrets } from '../../../security/secret-redact.ts'

import type { SessionEntry } from '@earendil-works/pi-coding-agent'

export const PACE_REQUEST_ENTRY = 'test-pace-request-v1'
export const PACE_GRANT_ENTRY = 'test-pace-grant-v1'
export const PACE_CREATED_ENTRY = 'test-pace-created-v1'
export const PACE_DECISION_ENTRY = 'test-pace-decision-v1'

/** `delegated`: a parent agent wrote it for a subagent. `relay`: another terminal typed it with `hc send`. */
export type RequestOrigin =
	| { kind: 'human' }
	| { kind: 'delegated' }
	| { kind: 'relay'; sender: string | undefined }

export type PaceRequest = { id: string; text: string; origin: RequestOrigin }

function readOrigin(candidate: unknown): RequestOrigin | undefined {
	const kind: unknown = Reflect.get(Object(candidate), 'kind')
	if (kind === 'human' || kind === 'delegated') return { kind }
	if (kind !== 'relay') return undefined
	const sender: unknown = Reflect.get(Object(candidate), 'sender')
	return { kind, sender: typeof sender === 'string' ? sender : undefined }
}

export function readPaceRequest(candidate: unknown): PaceRequest | undefined {
	const id: unknown = Reflect.get(Object(candidate), 'id')
	const text: unknown = Reflect.get(Object(candidate), 'text')
	const origin = readOrigin(Reflect.get(Object(candidate), 'origin'))
	if (typeof id !== 'string' || typeof text !== 'string' || !origin)
		return undefined
	return { id, text, origin }
}

export function typedOrigin(typed: string): RequestOrigin {
	const relay = readRelay(typed)
	return relay ? { kind: 'relay', sender: relay.sender } : { kind: 'human' }
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
