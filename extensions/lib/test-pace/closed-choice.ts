import { askChoice, isJevConfigured } from '#lib/jev/client.ts'

import { PACE_TIMEOUT_MS } from './decision.ts'

import type { ChoiceQuestion, ChoiceResult } from '#lib/jev/client.ts'

type Passing = { choice: string; threshold: number }
export type ClosedChoice = { isPassed: boolean; answer?: ChoiceResult }

/** Only the passing choice at its threshold passes; a missing key, a timeout or an error fails closed. */
export async function askClosedChoice(
	state: unknown,
	question: ChoiceQuestion,
	passing: Passing,
): Promise<ClosedChoice> {
	if (!isJevConfigured()) return { isPassed: false }
	try {
		const answer = await askChoice(state, question, {
			timeoutMs: PACE_TIMEOUT_MS,
		})
		const isPassed =
			answer.choice === passing.choice &&
			answer.confidence >= passing.threshold
		return { isPassed, answer }
	} catch {
		return { isPassed: false }
	}
}
