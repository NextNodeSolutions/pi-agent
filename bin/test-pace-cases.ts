import { readFileSync } from 'node:fs'

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

function withText<Case extends Labelled<string>>(...keys: readonly string[]) {
	return (sample: Labelled<string>): sample is Case =>
		keys.every(key => typeof Reflect.get(sample, key) === 'string')
}

export const operationCases = labelled(
	'./test-operation-cases.json',
	OPERATION_OUTCOMES,
).filter(withText<OperationCase>('question', 'operation'))
export const stopTargetCases = labelled(
	'./test-stop-target-cases.json',
	STOP_TARGETS,
).filter(withText<StopTargetCase>('question', 'thread'))
export const scopePathCases = labelled(
	'./test-scope-path-cases.json',
	SCOPE_PATH_ROLES,
).filter(withText<ScopePathCase>('question', 'path'))
export const paceCases = labelled('./test-pace-cases.json', [
	'bug',
	'logic',
	'none',
]).filter(withText<PaceCase>('intent'))
export const permissionCases = labelled(
	'./test-permission-cases.json',
	CONSENT_VERDICTS,
).flatMap((sample): PermissionCase[] => {
	const question: unknown = Reflect.get(sample, 'question') ?? ''
	if (typeof question !== 'string') return []
	const { id, request, expected } = sample
	return [{ id, question, request, expected }]
})
