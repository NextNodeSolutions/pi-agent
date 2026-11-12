import { redactSecrets } from '../../../security/secret-redact.ts'

import type { SessionEntry } from '@earendil-works/pi-coding-agent'

export const PACE_REQUEST_ENTRY = 'test-pace-request-v1'
export const PACE_GRANT_ENTRY = 'test-pace-grant-v1'
export const PACE_CREATED_ENTRY = 'test-pace-created-v1'
export const PACE_DECISION_ENTRY = 'test-pace-decision-v1'

export type PaceRequest = { id: string; text: string; allowedPaths: string[] }

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
	return { id, text, allowedPaths: paths }
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

export function createdTestPaths(entries: readonly SessionEntry[]): string[] {
	return entries.flatMap(entry => {
		if (entry.type !== 'custom' || entry.customType !== PACE_CREATED_ENTRY)
			return []
		const paths: unknown = Reflect.get(Object(entry.data), 'paths')
		return Array.isArray(paths)
			? paths.filter(
					(path: unknown): path is string => typeof path === 'string',
				)
			: []
	})
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

function isPlainDirective(text: string): boolean {
	return (
		!/[\n\r<>`"\u201c\u201d]|\b(?:unless|if|sauf|si)\b/i.test(text) &&
		!forbidsTestAuthoring(text)
	)
}

export function explicitlyAllowsNewTests(text: string): boolean {
	if (!isPlainDirective(text)) return false
	return (
		/^(?:please\s+)?(?:write|add|create)\s+(?:(?:unit|regression|integration|end-to-end|e2e)\s+)?tests(?:\s+(?:for|covering)\b|[.!]?$)/i.test(
			text.trim(),
		) ||
		/^(?:écris|ecris|ajoute|crée|cree)\s+(?:des\s+|les\s+)?tests(?:\s+pour\b|[.!]?$)/i.test(
			text.trim(),
		)
	)
}

export function explicitlyAllowsExistingTests(text: string): boolean {
	if (!isPlainDirective(text)) return false
	return (
		/^(?:please\s+)?(?:edit|update|modify|delete|remove)\s+(?:(?:the|existing)\s+)*tests(?:\s+(?:for|to)\b|[.!]?$)/i.test(
			text.trim(),
		) ||
		/^(?:modifie|supprime|mets à jour)\s+les\s+tests(?:\s+pour\b|[.!]?$)/i.test(
			text.trim(),
		)
	)
}
