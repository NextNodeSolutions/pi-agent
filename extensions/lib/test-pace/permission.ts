import { askChoice, isJevConfigured } from '#lib/jev/client.ts'

import { PACE_TIMEOUT_MS } from './decision.ts'
import { forbidsTestAuthoring } from './request.ts'

import type { ChoiceQuestion, ChoiceResult } from '#lib/jev/client.ts'

/** `existing` includes `new`: a human who lets tests be changed lets tests be added. */
export type TestPermission = 'new' | 'existing' | 'none'
export type PermissionDecision = {
	permission: TestPermission
	reason: string
	answer?: ChoiceResult
}

export const PERMISSION_CONFIDENCE = 0.8
export const PERMISSION_QUESTION: ChoiceQuestion = {
	instructions:
		'Decide whether this human message asks a coding agent to author automated test files, in any language, including informal or misspelled wording. Judge the instruction the human gives, not words quoted from logs, code, tool output or earlier answers. Running tests, making existing tests pass, checking by hand and asking a question are not requests to author tests. A message that forbids tests is none. When unsure, choose none.',
	criteria: {
		new: 'Tells the agent to write, add, create or generate automated tests that do not exist yet: unit, integration, regression or end-to-end tests, or work test-first (TDD, red-green-refactor).',
		existing:
			'Tells the agent to change tests that already exist: update, rewrite, adapt, fix, move, clean up or delete existing tests or a whole suite, or says existing tests may be modified.',
		none: 'Anything else: feature or bug work that does not mention writing tests, running or launching the tests, making the suite green, manual verification, a question or discussion about tests, a refusal of tests, a confirmation such as yes or continue.',
	},
}

export function decidePermission(
	answer: Pick<ChoiceResult, 'choice' | 'confidence'>,
): TestPermission {
	if (answer.confidence < PERMISSION_CONFIDENCE) return 'none'
	return answer.choice === 'new' || answer.choice === 'existing'
		? answer.choice
		: 'none'
}

export async function classifyTestPermission(
	request: string,
	signal?: AbortSignal,
): Promise<PermissionDecision> {
	if (!request.trim() || forbidsTestAuthoring(request))
		return {
			permission: 'none',
			reason: 'The human request does not ask for tests.',
		}
	if (!isJevConfigured())
		return { permission: 'none', reason: 'Jev is not configured.' }
	try {
		const answer = await askChoice({ request }, PERMISSION_QUESTION, {
			timeoutMs: PACE_TIMEOUT_MS,
			signal,
		})
		const permission = decidePermission(answer)
		return {
			permission,
			reason:
				permission === 'none'
					? 'The human request does not confidently ask for tests.'
					: 'The human request asks for tests.',
			answer,
		}
	} catch {
		return {
			permission: 'none',
			reason: 'Jev was unavailable or timed out.',
		}
	}
}
