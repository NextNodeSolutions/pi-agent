import { readFileSync } from 'node:fs'

import type { TestPace } from '../extensions/lib/test-pace/decision.ts'
import type { TestPermission } from '../extensions/lib/test-pace/permission.ts'

type PaceCase = {
	id: string
	request: string
	intent: string
	expected: TestPace
}
type PermissionCase = { id: string; request: string; expected: TestPermission }

function labelled(file: string, labels: readonly string[]): unknown[] {
	const samples: unknown = JSON.parse(
		readFileSync(new URL(file, import.meta.url), 'utf8'),
	)
	const valid =
		Array.isArray(samples) &&
		samples.every(
			sample =>
				typeof Reflect.get(Object(sample), 'id') === 'string' &&
				typeof Reflect.get(Object(sample), 'request') === 'string' &&
				labels.includes(Reflect.get(Object(sample), 'expected')),
		)
	if (!valid) throw new Error(`Expected labelled cases in ${file}.`)
	return samples
}

function isPaceCase(candidate: unknown): candidate is PaceCase {
	return typeof Reflect.get(Object(candidate), 'intent') === 'string'
}

function isPermissionCase(candidate: unknown): candidate is PermissionCase {
	return Boolean(candidate)
}

export const paceCases: PaceCase[] = labelled('./test-pace-cases.json', [
	'bug',
	'logic',
	'none',
]).filter(isPaceCase)
export const permissionCases: PermissionCase[] = labelled(
	'./test-permission-cases.json',
	['new', 'existing', 'none'],
).filter(isPermissionCase)
