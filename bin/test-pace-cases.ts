import { readFileSync } from 'node:fs'

import type { TestPace } from '../extensions/lib/test-pace/decision.ts'
import type { ConsentVerdict } from '../extensions/lib/test-pace/permission.ts'

type PaceCase = {
	id: string
	request: string
	intent: string
	expected: TestPace
}
/** `request` is the human's reply; `question` the agent text it answers, empty when it stands alone. */
type PermissionCase = {
	id: string
	question: string
	request: string
	expected: ConsentVerdict
}

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

function permissionCase(candidate: unknown): PermissionCase[] {
	const id: unknown = Reflect.get(Object(candidate), 'id')
	const request: unknown = Reflect.get(Object(candidate), 'request')
	const question: unknown = Reflect.get(Object(candidate), 'question') ?? ''
	const expected: unknown = Reflect.get(Object(candidate), 'expected')
	const valid =
		typeof id === 'string' &&
		typeof request === 'string' &&
		typeof question === 'string' &&
		(expected === 'new' ||
			expected === 'existing' ||
			expected === 'withdraw' ||
			expected === 'none')
	return valid ? [{ id, question, request, expected }] : []
}

type OperationCase = Pick<PermissionCase, 'id' | 'question' | 'request'> & {
	operation: string
	expected: 'allowed' | 'refused'
}

export const operationCases = labelled('./test-operation-cases.json', ['allowed', 'refused'])
	.filter((candidate): candidate is OperationCase =>
		typeof Reflect.get(Object(candidate), 'question') === 'string' &&
		typeof Reflect.get(Object(candidate), 'operation') === 'string',
	)

export const paceCases: PaceCase[] = labelled('./test-pace-cases.json', [
	'bug',
	'logic',
	'none',
]).filter(isPaceCase)
export const permissionCases: PermissionCase[] = labelled(
	'./test-permission-cases.json',
	['new', 'existing', 'withdraw', 'none'],
).flatMap(permissionCase)
