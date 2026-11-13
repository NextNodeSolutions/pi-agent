import { consentCovers, consentScope } from './consent-scope.ts'
import { classifyConsent } from './permission.ts'

import type { ConsentDecision, ConsentVerdict } from './permission.ts'

export const PACE_CONSENT_ENTRY = 'test-pace-consent-v1'
const JUDGE_CONCURRENCY = 6
const TEST_TOPIC = /test|spec|fixture|suite|e2e|tdd/iu

/** A human's words and the agent text they answer; `at` is an ISO timestamp. */
export type Evidence = {
	id: string
	at: string
	question: string
	reply: string
	mayGrant?: boolean
}
export type Judgment = {
	evidenceId: string
	at: string
	verdict: ConsentVerdict
	scope: string[]
	question: string
	reply: string
}
export type ConsentKind = 'new' | 'existing' | 'none'
/** `answered`: Jev decided, so the judgment can be recorded instead of asked again. */
export type Judged = { judgment: Judgment; answered: boolean }

export async function judgeEvidence(
	root: string,
	evidence: Evidence,
): Promise<Judged> {
	const decision: ConsentDecision = TEST_TOPIC.test(
		`${evidence.question}\n${evidence.reply}`,
	)
		? await classifyConsent(evidence)
		: { verdict: 'none' }
	const verdict =
		evidence.mayGrant === false && decision.verdict !== 'withdraw'
			? 'none'
			: decision.verdict
	const granted = verdict === 'new' || verdict === 'existing'
	return {
		judgment: {
			evidenceId: evidence.id,
			at: evidence.at,
			question: evidence.question,
			reply: evidence.reply,
			verdict,
			scope: granted
				? await consentScope(root, [evidence.question, evidence.reply])
				: [],
		},
		answered: Boolean(decision.answer),
	}
}

export async function judgeAll<Subject, Verdict>(
	subjects: readonly Subject[],
	judge: (subject: Subject) => Promise<Verdict>,
): Promise<Verdict[]> {
	const queue = subjects.map((subject, index) => ({ subject, index }))
	const settled: { index: number; verdict: Verdict }[] = []
	async function next(): Promise<void> {
		const task = queue.shift()
		if (!task) return
		settled.push({ index: task.index, verdict: await judge(task.subject) })
		await next()
	}
	await Promise.all(Array.from({ length: JUDGE_CONCURRENCY }, next))
	return settled
		.toSorted((a, b) => a.index - b.index)
		.map(({ verdict }) => verdict)
}

/** Grants accumulate in time order; a withdrawal clears every grant before it. */
export function activeConsents(judgments: readonly Judgment[]): Judgment[] {
	const ordered = judgments.toSorted((a, b) => a.at.localeCompare(b.at))
	const withdrawn = ordered.findLastIndex(
		judgment => judgment.verdict === 'withdraw',
	)
	return ordered
		.slice(withdrawn + 1)
		.filter(
			judgment =>
				judgment.verdict === 'new' || judgment.verdict === 'existing',
		)
}

export function consentKind(
	consents: readonly Judgment[],
	path: string,
): ConsentKind {
	const covering = consents.filter(consent =>
		consentCovers(consent.scope, path),
	)
	if (covering.some(consent => consent.verdict === 'existing'))
		return 'existing'
	return covering.length ? 'new' : 'none'
}

function readJudgment(saved: unknown): Judgment | undefined {
	const evidenceId: unknown = Reflect.get(Object(saved), 'evidenceId')
	const at: unknown = Reflect.get(Object(saved), 'at')
	const verdict: unknown = Reflect.get(Object(saved), 'verdict')
	const scope: unknown = Reflect.get(Object(saved), 'scope')
	const question: unknown = Reflect.get(Object(saved), 'question')
	const reply: unknown = Reflect.get(Object(saved), 'reply')
	const valid =
		typeof evidenceId === 'string' &&
		typeof at === 'string' &&
		typeof question === 'string' &&
		typeof reply === 'string' &&
		(verdict === 'new' ||
			verdict === 'existing' ||
			verdict === 'withdraw' ||
			verdict === 'none') &&
		Array.isArray(scope) &&
		scope.every(path => typeof path === 'string')
	if (!valid) return undefined
	return { evidenceId, at, verdict, scope, question, reply }
}

export function recordedJudgments(
	entries: readonly unknown[],
): Map<string, Judgment> {
	return new Map(
		entries.flatMap(entry => {
			if (Reflect.get(Object(entry), 'customType') !== PACE_CONSENT_ENTRY)
				return []
			const judgment = readJudgment(Reflect.get(Object(entry), 'data'))
			return judgment ? [[judgment.evidenceId, judgment] as const] : []
		}),
	)
}
