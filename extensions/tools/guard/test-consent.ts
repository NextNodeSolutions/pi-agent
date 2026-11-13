import { isSubagentChild } from '#lib/subagent-child.ts'
import {
	judgeEvidence,
	PACE_CONSENT_ENTRY,
	recordedJudgments,
	sessionConsents,
} from '#lib/test-pace/consent.ts'
import { sessionRecords } from '#lib/test-pace/evidence.ts'
import { physicalPath } from '#lib/test-pace/physical-path.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { Judgment } from '#lib/test-pace/consent.ts'
import type { Evidence } from '#lib/test-pace/evidence.ts'

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
		const recorded = recordedJudgments(entries)
		const root = await physicalPath(ctx.cwd)
		return sessionConsents(
			sessionRecords(entries),
			async evidence =>
				recorded.get(evidence.id) ?? shared(root, evidence),
		)
	}
}
