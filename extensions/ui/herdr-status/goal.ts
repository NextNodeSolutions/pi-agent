import { activeGoal } from '#lib/goal/state.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'

type PublishGoal = (shown: string) => Promise<void>

function openItems(ctx: ExtensionContext): string {
	const goal = activeGoal(ctx.sessionManager.getBranch())
	if (!goal) return ''
	const items = [goal, ...(goal.paused ?? [])].flatMap(each => each.items)
	const open = items.filter(task => !task.done).length
	return open === 0 ? '' : `${open} of ${items.length} items open`
}

// Subagents inherit the terminal of the session that runs them, so only the interactive session speaks for it.
export function registerGoalLabel(
	pi: ExtensionAPI,
	publish: PublishGoal,
): void {
	const report = (ctx: ExtensionContext): void => {
		if (ctx.hasUI) void publish(openItems(ctx))
	}
	pi.on('session_start', (_event, ctx) => report(ctx))
	pi.on('agent_settled', (_event, ctx) => report(ctx))
	pi.on('session_shutdown', (_event, ctx) => {
		if (ctx.hasUI) void publish('')
	})
}
