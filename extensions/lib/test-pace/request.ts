import { redactSecrets } from '../../../security/secret-redact.ts'

import type { SessionEntry } from '@earendil-works/pi-coding-agent'

export const PACE_REQUEST_ENTRY = 'test-pace-request-v1'
export const PACE_GRANT_ENTRY = 'test-pace-grant-v1'
export const PACE_CREATED_ENTRY = 'test-pace-created-v1'
export const PACE_DECISION_ENTRY = 'test-pace-decision-v1'
export const PACE_PERMISSION_ENTRY = 'test-pace-permission-v1'

export type PaceRequest = {
	id: string
	text: string
	/** Files or directories the human named with /test-pace allow. */
	allowedPaths: string[]
	/** Written by a parent agent for a subagent, so it carries no human permission. */
	delegated: boolean
}

export function readPaceRequest(candidate: unknown): PaceRequest | undefined {
	if (!candidate || typeof candidate !== 'object') return undefined
	const id: unknown = Reflect.get(candidate, 'id')
	const text: unknown = Reflect.get(candidate, 'text')
	const paths: unknown = Reflect.get(candidate, 'allowedPaths')
	if (
		typeof id !== 'string' ||
		typeof text !== 'string' ||
		!Array.isArray(paths)
	)
		return undefined
	if (!paths.every((path: unknown) => typeof path === 'string'))
		return undefined
	return {
		id,
		text,
		allowedPaths: paths,
		delegated: Reflect.get(candidate, 'delegated') === true,
	}
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

export function recordedPermission(
	entries: readonly SessionEntry[],
	requestId: string,
): 'new' | 'existing' | 'none' | undefined {
	const saved = entries.findLast(
		entry =>
			entry.type === 'custom' &&
			entry.customType === PACE_PERMISSION_ENTRY &&
			Reflect.get(Object(entry.data), 'requestId') === requestId,
	)
	if (saved?.type !== 'custom') return undefined
	const permission: unknown = Reflect.get(Object(saved.data), 'permission')
	if (
		permission === 'new' ||
		permission === 'existing' ||
		permission === 'none'
	)
		return permission
	return undefined
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
