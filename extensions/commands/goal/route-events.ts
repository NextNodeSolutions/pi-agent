/**
 * Record genuine human input locally and show the checklist to the model.
 * Interpreting the input stays with the running agent; the checklist travels
 * through the `context` event, never as a persisted message, placed as
 * `context-checklists.ts` decides.
 */
import {
	activeGoal,
	GOAL_CHANGE_AUTHORIZATION_ENTRY,
	MAX_GOAL_TEXT,
} from '#lib/goal/state.ts'
import { isHumanPrompt, typedPromptText } from '#lib/human-prompt.ts'
import { runTimedHook } from '#lib/telemetry/hook-timing.ts'

import { withGoalChecklists } from './context-checklists.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export function registerGoalRouting(pi: ExtensionAPI): void {
	let pendingPrompt: string | undefined
	const clear = (): void => {
		pendingPrompt = undefined
	}
	pi.on('session_start', clear)
	pi.on('session_tree', clear)
	pi.on('session_shutdown', clear)
	pi.on('input', event => {
		if (isHumanPrompt(event)) pendingPrompt = event.text
	})
	pi.on('before_agent_start', (_event, ctx) =>
		runTimedHook('before_agent_start', 'goal.route', () => {
			const prompt = pendingPrompt
			pendingPrompt = undefined
			if (!prompt) return
			// A candidate request, not permission: manage.ts verifies coverage.
			const normalized = typedPromptText(prompt)
				.replace(/\s+/g, ' ')
				.trim()
			pi.appendEntry(GOAL_CHANGE_AUTHORIZATION_ENTRY, {
				revision:
					activeGoal(ctx.sessionManager.getBranch())?.revision ?? 0,
				prompt: normalized.slice(0, MAX_GOAL_TEXT),
				truncated: normalized.length > MAX_GOAL_TEXT,
			})
		}),
	)
	pi.on('context', (event, ctx) => ({
		messages: withGoalChecklists(
			event.messages,
			ctx.sessionManager.getBranch(),
		),
	}))
}
