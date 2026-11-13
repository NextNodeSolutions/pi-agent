import { askChoice, isJevConfigured } from '#lib/jev/client.ts'

import type { ChoiceQuestion, ChoiceResult } from '#lib/jev/client.ts'

const JUDGE_TIMEOUT_MS = 4_000

/** A two-way question whose criteria keys are its labels. */
export type ClosedQuestion<Label extends string> = {
	instructions: string
	criteria: Record<Label, string>
}
type Passing<Label extends string> = { choice: Label; threshold: number }
type ClosedChoice = { isPassed: boolean; answer?: ChoiceResult }

/** A missing key, a timeout, an abort or an error gives no answer. */
export async function judgeAnswer(
	state: unknown,
	question: ChoiceQuestion,
	signal?: AbortSignal,
): Promise<ChoiceResult | undefined> {
	if (!isJevConfigured()) return undefined
	try {
		return await askChoice(state, question, {
			timeoutMs: JUDGE_TIMEOUT_MS,
			signal,
		})
	} catch {
		return undefined
	}
}

/** Only the passing choice at its threshold passes; no answer fails closed. */
export async function askClosedChoice<Label extends string>(
	state: unknown,
	question: ClosedQuestion<Label>,
	passing: Passing<NoInfer<Label>>,
): Promise<ClosedChoice> {
	const answer = await judgeAnswer(state, question)
	if (!answer) return { isPassed: false }
	const isPassed =
		answer.choice === passing.choice &&
		answer.confidence >= passing.threshold
	return { isPassed, answer }
}
