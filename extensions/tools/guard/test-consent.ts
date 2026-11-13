import { isSubagentChild } from '#lib/subagent-child.ts'
import {
	activeConsents,
	judgeAll,
	judgeEvidence,
	PACE_CONSENT_ENTRY,
	recordedJudgments,
} from '#lib/test-pace/consent.ts'
import { sessionRecords } from '#lib/test-pace/evidence.ts'
import { physicalPath } from '#lib/test-pace/physical-path.ts'
import { relayedEvidence } from '#lib/test-pace/relay-evidence.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { Evidence, Judgment } from '#lib/test-pace/consent.ts'

export type ConsentReader = (ctx: ExtensionContext) => Promise<Judgment[]>

/** Judges each human answer once per branch; Jev's verdicts are recorded so later writes reread them. */
export function consentReader(pi: ExtensionAPI): ConsentReader {
	const judging = new Map<string, Promise<Judgment>>()
	async function judge(root: string, evidence: Evidence): Promise<Judgment> {
		const { judgment, answered } = await judgeEvidence(root, evidence)
		if (answered) pi.appendEntry(PACE_CONSENT_ENTRY, judgment)
		return judgment
	}
	async function judgeOnce(
		root: string,
		evidence: Evidence,
	): Promise<Judgment> {
		try {
			return await judge(root, evidence)
		} finally {
			judging.delete(evidence.id)
		}
	}
	function shared(root: string, evidence: Evidence): Promise<Judgment> {
		const pending = judging.get(evidence.id) ?? judgeOnce(root, evidence)
		judging.set(evidence.id, pending)
		return pending
	}
	return async ctx => {
		if (isSubagentChild()) return []
		const entries = ctx.sessionManager.getBranch()
		const records = sessionRecords(entries)
		const relayed = await relayedEvidence(
			records.relays,
			process.env.HC_TERMINAL_ID,
		)
		const recorded = recordedJudgments(entries)
		const root = await physicalPath(ctx.cwd)
		const judgments = await judgeAll(
			[...records.evidence, ...relayed],
			async evidence =>
				recorded.get(evidence.id) ?? shared(root, evidence),
		)
		return activeConsents(judgments)
	}
}
