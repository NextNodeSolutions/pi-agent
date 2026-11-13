import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { consentCovers, consentScope } from './consent-scope.ts'
import { classifyConsent, CONSENT_VERDICTS, isGrant } from './permission.ts'
import { relayedEvidence } from './relay-evidence.ts'

import type { Static } from 'typebox'
import type { Evidence, SessionRecords } from './evidence.ts'
import type { ConsentDecision } from './permission.ts'

export const PACE_CONSENT_ENTRY = 'test-pace-consent-v1'
const JUDGE_CONCURRENCY = 6
const TEST_TOPIC = /test|spec|fixture|suite|e2e|tdd/iu

const JUDGMENT_SCHEMA = Type.Object({
	evidenceId: Type.String(),
	at: Type.String(),
	verdict: Type.Enum(CONSENT_VERDICTS),
	scope: Type.Array(Type.String()),
	question: Type.String(),
	reply: Type.String(),
})

export type Judgment = Static<typeof JUDGMENT_SCHEMA>

export type EditKind = 'new' | 'existing'
export type ConsentKind = EditKind | 'none'
/** `answered`: Jev decided, so the judgment can be recorded instead of asked again. */
export type Judged = { judgment: Judgment; answered: boolean }
export type Judge = (evidence: Evidence) => Promise<Judgment>

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
	return {
		judgment: {
			evidenceId: evidence.id,
			at: evidence.at,
			question: evidence.question,
			reply: evidence.reply,
			verdict,
			scope: isGrant(verdict)
				? await consentScope(root, [evidence.question, evidence.reply])
				: [],
		},
		answered: Boolean(decision.answer),
	}
}

async function judgeAll(
	evidence: readonly Evidence[],
	judge: Judge,
): Promise<Judgment[]> {
	const queue = [...evidence.entries()]
	const judgments: Judgment[] = []
	async function next(): Promise<void> {
		const task = queue.shift()
		if (!task) return
		const [index, subject] = task
		judgments[index] = await judge(subject)
		await next()
	}
	await Promise.all(Array.from({ length: JUDGE_CONCURRENCY }, next))
	return judgments
}

function activeConsents(judgments: readonly Judgment[]): Judgment[] {
	const ordered = judgments.toSorted((a, b) => a.at.localeCompare(b.at))
	const withdrawn = ordered.findLastIndex(
		judgment => judgment.verdict === 'withdraw',
	)
	return ordered
		.slice(withdrawn + 1)
		.filter(judgment => isGrant(judgment.verdict))
}

export async function sessionConsents(
	records: SessionRecords,
	judge: Judge,
): Promise<Judgment[]> {
	const relayed = await relayedEvidence(records.relays)
	return activeConsents(
		await judgeAll([...records.evidence, ...relayed], judge),
	)
}

export function consentsAllowing(
	consents: readonly Judgment[],
	path: string,
	kind: EditKind,
): Judgment[] {
	return consents.filter(
		consent =>
			consentCovers(consent.scope, path) &&
			(consent.verdict === 'existing' ||
				(kind === 'new' && consent.verdict === 'new')),
	)
}

export function consentKind(
	consents: readonly Judgment[],
	path: string,
): ConsentKind {
	if (consentsAllowing(consents, path, 'existing').length) return 'existing'
	return consentsAllowing(consents, path, 'new').length ? 'new' : 'none'
}

export function recordedJudgments(
	entries: readonly unknown[],
): Map<string, Judgment> {
	return new Map(
		entries.flatMap(entry => {
			if (Reflect.get(Object(entry), 'customType') !== PACE_CONSENT_ENTRY)
				return []
			const saved: unknown = Reflect.get(Object(entry), 'data')
			return Value.Check(JUDGMENT_SCHEMA, saved)
				? [[saved.evidenceId, saved] as const]
				: []
		}),
	)
}
