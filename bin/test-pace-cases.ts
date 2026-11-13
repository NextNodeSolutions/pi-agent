import { readFileSync } from 'node:fs'

import { CONSENT_VERDICTS } from '../extensions/lib/test-pace/permission.ts'

import type { TestPace } from '../extensions/lib/test-pace/decision.ts'
import type { ConsentVerdict } from '../extensions/lib/test-pace/permission.ts'

export const OPERATION_OUTCOMES = ['allowed', 'refused'] as const

type Labelled<Label extends string> = {
	id: string
	request: string
	expected: Label
}
type PaceCase = Labelled<TestPace> & { intent: string }
/** `request` is the human's reply; `question` the agent text it answers, empty when it stands alone. */
type PermissionCase = Labelled<ConsentVerdict> & { question: string }
type OperationCase = Labelled<(typeof OPERATION_OUTCOMES)[number]> & {
	question: string
	operation: string
}

function labelled<Label extends string>(
	file: string,
	labels: readonly Label[],
): Labelled<Label>[] {
	const samples: unknown = JSON.parse(
		readFileSync(new URL(file, import.meta.url), 'utf8'),
	)
	const isLabelled = (sample: unknown): sample is Labelled<Label> =>
		typeof Reflect.get(Object(sample), 'id') === 'string' &&
		typeof Reflect.get(Object(sample), 'request') === 'string' &&
		labels.some(label => label === Reflect.get(Object(sample), 'expected'))
	if (!Array.isArray(samples) || !samples.every(isLabelled))
		throw new Error(`Expected labelled cases in ${file}.`)
	return samples
}

export const operationCases = labelled(
	'./test-operation-cases.json',
	OPERATION_OUTCOMES,
).filter(
	(sample): sample is OperationCase =>
		typeof Reflect.get(sample, 'question') === 'string' &&
		typeof Reflect.get(sample, 'operation') === 'string',
)
export const paceCases = labelled('./test-pace-cases.json', [
	'bug',
	'logic',
	'none',
]).filter(
	(sample): sample is PaceCase =>
		typeof Reflect.get(sample, 'intent') === 'string',
)
export const permissionCases = labelled(
	'./test-permission-cases.json',
	CONSENT_VERDICTS,
).flatMap((sample): PermissionCase[] => {
	const question: unknown = Reflect.get(sample, 'question') ?? ''
	if (typeof question !== 'string') return []
	const { id, request, expected } = sample
	return [{ id, question, request, expected }]
})
