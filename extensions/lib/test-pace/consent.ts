import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { consentCovers, consentScope } from './consent-scope.ts'
import { classifyConsent, CONSENT_VERDICTS, isGrant } from './permission.ts'
import { relayedEvidence } from './relay-evidence.ts'
import { classifyScopePath } from './scope-path.ts'
import { classifyStopTarget } from './stop-target.ts'

import type { Static } from 'typebox'
import type { Evidence, SessionRecords } from './evidence.ts'
import type { ConsentDecision, ConsentVerdict } from './permission.ts'

export const PACE_CONSENT_ENTRY = 'test-pace-consent-v1'
const JUDGE_CONCURRENCY = 6
const TEST_TOPIC =
	/test|spec|fixture|suite|e2e|tdd|snapshot|mock|jest|cypress|playwright/iu

const JUDGMENT_SCHEMA = Type.Object({
	evidenceId: Type.String(),
	at: Type.String(),
	verdict: Type.Enum(CONSENT_VERDICTS),
	scope: Type.Array(Type.String()),
	question: Type.String(),
	reply: Type.String(),
})

export type Judgment = Static<typeof JUDGMENT_SCHEMA>

type EditKind = 'new' | 'existing'
export type ConsentKind = EditKind | 'none'
/** `answered`: Jev decided, so the judgment can be recorded instead of asked again. */
type Judged = { judgment: Judgment; answered: boolean }
type Decided = { verdict: ConsentVerdict; answered: boolean }
type Scoped = { scope: string[]; answered: boolean }
type Judge = (evidence: Evidence) => Promise<Judgment>

async function stopVerdict(
	evidence: Evidence,
	decision: ConsentDecision,
): Promise<Decided> {
	const answered = Boolean(decision.answer)
	if (!evidence.receiver || !answered)
		return { verdict: 'withdraw', answered }
	const stop = await classifyStopTarget(evidence, evidence.receiver)
	return {
		verdict: stop.target === 'elsewhere' ? 'none' : 'withdraw',
		answered: Boolean(stop.answer),
	}
}

async function decide(evidence: Evidence): Promise<Decided> {
	if (!TEST_TOPIC.test(`${evidence.question}\n${evidence.reply}`))
		return { verdict: 'none', answered: false }
	const decision = await classifyConsent(evidence)
	if (decision.verdict === 'withdraw') return stopVerdict(evidence, decision)
	return {
		verdict: evidence.mayGrant === false ? 'none' : decision.verdict,
		answered: Boolean(decision.answer),
	}
}

const UNSCOPED: Scoped = { scope: [], answered: true }

/** A path Jev did not read leaves the exchange granting nothing and its judgment unrecorded, so it is read again. */
async function grantScope(root: string, evidence: Evidence): Promise<Scoped> {
	let isEveryPathRead = true
	const scope = await consentScope(
		root,
		async written => {
			const decision = await classifyScopePath(evidence, written)
			isEveryPathRead &&= Boolean(decision.answer)
			return decision.role === 'covered'
		},
		[evidence.scopeText ?? evidence.question, evidence.reply],
	)
	return isEveryPathRead
		? { scope, answered: true }
		: { ...UNSCOPED, answered: false }
}

export async function judgeEvidence(
	root: string,
	evidence: Evidence,
): Promise<Judged> {
	const { verdict, answered } = await decide(evidence)
	const granted = isGrant(verdict)
		? await grantScope(root, evidence)
		: UNSCOPED
	return {
		judgment: {
			evidenceId: evidence.id,
			at: evidence.at,
			question: evidence.question,
			reply: evidence.reply,
			verdict: granted.answered ? verdict : 'none',
			scope: granted.scope,
		},
		answered: answered && granted.answered,
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

/** A grant naming no path covers what the active grants before it allowing its edit kind cover, never the whole repository. */
function inheritedScopes(grants: readonly Judgment[]): Judgment[] {
	return grants.map((grant, index) => {
		if (grant.scope.length) return grant
		const earlier = grants
			.slice(0, index)
			.filter(before => allowsKind(before.verdict, grant.verdict))
			.flatMap(before => before.scope)
		return { ...grant, scope: Array.from(new Set(earlier)) }
	})
}

function activeConsents(judgments: readonly Judgment[]): Judgment[] {
	const ordered = judgments.toSorted((a, b) => a.at.localeCompare(b.at))
	const withdrawn = ordered.findLastIndex(
		judgment => judgment.verdict === 'withdraw',
	)
	return inheritedScopes(
		ordered
			.slice(withdrawn + 1)
			.filter(judgment => isGrant(judgment.verdict)),
	).filter(grant => grant.scope.length)
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
			allowsKind(consent.verdict, kind),
	)
}

function allowsKind(verdict: ConsentVerdict, kind: ConsentVerdict): boolean {
	return verdict === 'existing' || (kind === 'new' && verdict === 'new')
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
