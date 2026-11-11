// Own the fallback continuation message contract and transcript presentation.
import { Text } from '@earendil-works/pi-tui'

import { activeGoal, goalText } from '#lib/goal/state.ts'

import type {
	CustomMessageEntryDraft,
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { FailureSighting } from './fallback-session.ts'

export const FALLBACK_MESSAGE_TYPE = 'model-fallback'

export interface FallbackMessageDetails {
	failedModel?: string | undefined
	candidate?: string | undefined
	reason?: string | undefined
}

/** Continue the same request with the current checklist, without creating human input. */
export function continuationAfterFailover(
	ctx: ExtensionContext,
	failure: FailureSighting,
	candidate: string,
): Omit<CustomMessageEntryDraft, 'type'> {
	const goal = activeGoal(ctx.sessionManager.getBranch())
	return {
		customType: FALLBACK_MESSAGE_TYPE,
		content: [
			`The previous model attempt failed (${failure.reason}). The session switched to ${candidate}. Follow the latest human request and resume it from its last verified result. A provider failure is not task completion. Retain the checklist and its existing IDs; only verified results complete items. This recovery message is not a new human request.`,
			goal ? goalText(goal) : '',
		]
			.filter(Boolean)
			.join('\n'),
		display: true,
		details: {
			failedModel: failure.model,
			candidate,
			reason: failure.reason,
		} satisfies FallbackMessageDetails,
	}
}

export function registerFallbackRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<FallbackMessageDetails>(
		FALLBACK_MESSAGE_TYPE,
		(message, { expanded, outputPad }, theme) => {
			const { failedModel, candidate, reason } = message.details ?? {}
			const summary = `↯ ${failedModel ?? 'the previous model'} failed (${reason ?? 'provider error'}) → fallback ${candidate ?? 'the next model'}`
			const detail = expanded
				? `\n  the turn restarted on ${candidate ?? 'the next model'}; completed work is kept`
				: ''
			return new Text(theme.fg('dim', summary + detail), outputPad, 0)
		},
	)
}
