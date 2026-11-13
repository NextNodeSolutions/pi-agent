import { askChoice, isJevConfigured } from '#lib/jev/client.ts'

import { PACE_TIMEOUT_MS } from './decision.ts'
import { judgedExchange } from './permission.ts'

import type { ChoiceQuestion, ChoiceResult } from '#lib/jev/client.ts'
import type { ConsentExchange } from './permission.ts'

export const STOP_TARGET_CONFIDENCE = 0.8
export const STOP_TARGETS = ['elsewhere', 'here'] as const
type StopTarget = (typeof STOP_TARGETS)[number]
type StopDecision = { target: StopTarget; answer?: ChoiceResult }

const STOP_TARGET_QUESTION: ChoiceQuestion = {
	instructions:
		"In another agent's conversation, the agent wrote agentMessage and the human answered humanReply, which stops or refuses test edits. thisThread is a different agent session, named by its terminal address and title. Decide whether that stop concerns the work of thisThread. Only work that agentMessage or humanReply names counts: a thread, terminal, pull request, branch, repository, task or path. Choose elsewhere only when the stop clearly concerns named work other than thisThread. When it names thisThread or its work, names no work, applies to every test edit, or its target cannot be established, choose here.",
	criteria: {
		elsewhere:
			'The stop clearly concerns named work other than thisThread.',
		here: 'The stop may concern thisThread: it names thisThread or its work, names no work, applies to every test edit, or its target cannot be established.',
	},
}

/** Any doubt, an unread answer included, keeps the stop in force here. */
export async function classifyStopTarget(
	exchange: ConsentExchange,
	thread: string,
): Promise<StopDecision> {
	if (!isJevConfigured()) return { target: 'here' }
	try {
		const answer = await askChoice(
			{ ...judgedExchange(exchange), thisThread: thread },
			STOP_TARGET_QUESTION,
			{ timeoutMs: PACE_TIMEOUT_MS },
		)
		const isElsewhere =
			answer.choice === 'elsewhere' &&
			answer.confidence >= STOP_TARGET_CONFIDENCE
		return { target: isElsewhere ? 'elsewhere' : 'here', answer }
	} catch {
		return { target: 'here' }
	}
}
