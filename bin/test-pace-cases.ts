import { readFileSync } from 'node:fs'

import { TEST_PACES } from '../extensions/lib/test-pace/decision.ts'
import { OPERATION_OUTCOMES } from '../extensions/lib/test-pace/operation.ts'
import { CONSENT_VERDICTS } from '../extensions/lib/test-pace/permission.ts'
import { SCOPE_PATH_ROLES } from '../extensions/lib/test-pace/scope-path.ts'
import { STOP_TARGETS } from '../extensions/lib/test-pace/stop-target.ts'

import type { TestPace } from '../extensions/lib/test-pace/decision.ts'
import type { ConsentVerdict } from '../extensions/lib/test-pace/permission.ts'

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
/** `request` is a stop the human typed to another terminal; `thread` names the terminal whose grants it may cancel. */
type StopTargetCase = Labelled<(typeof STOP_TARGETS)[number]> & {
	question: string
	thread: string
}
/** `path` is written in the exchange of `question` and `request`; `expected` says whether that consent covers it. */
type ScopePathCase = Labelled<(typeof SCOPE_PATH_ROLES)[number]> & {
	question: string
	path: string
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

function cases<Label extends string, Case extends Labelled<Label>>(
	file: string,
	labels: readonly Label[],
	isCase: (sample: Labelled<Label>) => sample is Case,
): Case[] {
	const samples = labelled(file, labels)
	if (!samples.every(isCase))
		throw new Error(`Expected every case in ${file} to carry its fields.`)
	return samples
}

export const operationCases = cases(
	'./test-operation-cases.json',
	OPERATION_OUTCOMES,
	(sample): sample is OperationCase =>
		typeof Reflect.get(sample, 'question') === 'string' &&
		typeof Reflect.get(sample, 'operation') === 'string',
)
export const stopTargetCases = cases(
	'./test-stop-target-cases.json',
	STOP_TARGETS,
	(sample): sample is StopTargetCase =>
		typeof Reflect.get(sample, 'question') === 'string' &&
		typeof Reflect.get(sample, 'thread') === 'string',
)
export const scopePathCases = cases(
	'./test-scope-path-cases.json',
	SCOPE_PATH_ROLES,
	(sample): sample is ScopePathCase =>
		typeof Reflect.get(sample, 'question') === 'string' &&
		typeof Reflect.get(sample, 'path') === 'string',
)
export const paceCases = cases(
	'./test-pace-cases.json',
	TEST_PACES,
	(sample): sample is PaceCase =>
		typeof Reflect.get(sample, 'intent') === 'string',
)
export const permissionCases = cases(
	'./test-permission-cases.json',
	CONSENT_VERDICTS,
	(sample): sample is Labelled<ConsentVerdict> & { question?: string } =>
		['string', 'undefined'].includes(typeof Reflect.get(sample, 'question')),
).map(
	({ id, question, request, expected }): PermissionCase => ({
		id,
		question: question ?? '',
		request,
		expected,
	}),
)
