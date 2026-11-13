import { errorText } from '#lib/error-text.ts'

import { closeTerminal } from './closing.ts'
import { keepInstead } from './decide.ts'

import type { Candidate, Closing, ClosingScene } from './closing.ts'
import type { Verdict } from './decide.ts'
import type { ClosedEvent } from './journal.ts'

export type Closings = {
	closed: ClosedEvent[]
	refusals: Record<string, string>
}

async function closeOne(
	candidate: Candidate,
	scene: ClosingScene,
): Promise<Closing> {
	try {
		return await closeTerminal(candidate, scene)
	} catch (error) {
		return { closed: [], refusal: errorText(error) }
	}
}

// One failed close must not stop the others, so each candidate's failure becomes its own refusal; a candidate an earlier close already ended is skipped.
export function closeEach(
	confirmed: readonly Candidate[],
	scene: ClosingScene,
): Promise<Closings> {
	return confirmed.reduce<Promise<Closings>>(
		async (earlier, candidate) => {
			const done = await earlier
			const { address } = candidate.verdict.terminal
			if (done.closed.some(event => event.address === address))
				return done
			const { closed, refusal } = await closeOne(candidate, scene)
			return {
				closed: [...done.closed, ...closed],
				refusals:
					refusal === null
						? done.refusals
						: { ...done.refusals, [address]: refusal },
			}
		},
		Promise.resolve({ closed: [], refusals: {} }),
	)
}

export function withRefusals(
	verdicts: readonly Verdict[],
	refusals: Closings['refusals'],
): Verdict[] {
	return verdicts.map(verdict => {
		const refusal = refusals[verdict.terminal.address]
		if (refusal === undefined) return verdict
		return keepInstead(
			verdict,
			'refused',
			`closing it was called off: ${refusal.replace(/\s+/g, ' ').trim()}`,
		)
	})
}
