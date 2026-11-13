import { askClosedChoice } from './closed-choice.ts'
import { judgedExchange } from './exchange.ts'

import type { ChoiceResult } from '#lib/jev/client.ts'
import type { ClosedQuestion } from './closed-choice.ts'
import type { ConsentExchange } from './exchange.ts'

export const SCOPE_PATH_CONFIDENCE = 0.8
export const SCOPE_PATH_ROLES = ['covered', 'context'] as const
type ScopePathRole = (typeof SCOPE_PATH_ROLES)[number]
type ScopePathDecision = { isCovered: boolean; answer?: ChoiceResult }

const SCOPE_PATH_QUESTION: ClosedQuestion<ScopePathRole> = {
	instructions:
		'The agent wrote agentMessage and the human answered humanReply, allowing test edits. namedPath is a path written in that exchange. Decide whether the permission lets the agent edit, create or move tests at namedPath. Covered: a test file, test directory or pattern the agent asked to change, a directory the tests move into, or a directory whose tests the human allowed. Context: a path written for another reason, such as the code under test, where a code change happens, a file to read, a path the human excluded or refused, or files the agent says it will leave alone. When the role of namedPath cannot be established, choose context.',
	criteria: {
		covered:
			'The permission lets the agent edit, create or move tests at namedPath.',
		context:
			'namedPath is written for another reason, is excluded, or its role cannot be established.',
	},
}

/** Any doubt, an unread answer included, keeps the path out of the grant. */
export async function classifyScopePath(
	exchange: ConsentExchange,
	namedPath: string,
): Promise<ScopePathDecision> {
	const { isPassed, ...answered } = await askClosedChoice(
		{ ...judgedExchange(exchange), namedPath },
		SCOPE_PATH_QUESTION,
		{ choice: 'covered', threshold: SCOPE_PATH_CONFIDENCE },
	)
	return { isCovered: isPassed, ...answered }
}
