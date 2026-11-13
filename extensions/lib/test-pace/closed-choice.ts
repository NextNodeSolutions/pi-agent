import { askChoice, isJevConfigured } from '#lib/jev/client.ts'

import { PACE_TIMEOUT_MS } from './decision.ts'

import type { ChoiceQuestion, ChoiceResult } from '#lib/jev/client.ts'

type ClosedQuestion<Label extends string> = ChoiceQuestion & {
	criteria: Record<Label, string>
}
type ClosedChoice<Label extends string> = {
	choice: Label
	answer?: ChoiceResult
}

/** Only the passing label at its threshold passes; a missing key, a timeout or an error fails closed. */
export async function askClosedChoice<Label extends string>(
	state: unknown,
	question: ClosedQuestion<NoInfer<Label>>,
	[passing, failing]: readonly [passing: Label, failing: Label],
	threshold: number,
): Promise<ClosedChoice<Label>> {
	if (!isJevConfigured()) return { choice: failing }
	try {
		const answer = await askChoice(state, question, {
			timeoutMs: PACE_TIMEOUT_MS,
		})
		const isPassed =
			answer.choice === passing && answer.confidence >= threshold
		return { choice: isPassed ? passing : failing, answer }
	} catch {
		return { choice: failing }
	}
}
