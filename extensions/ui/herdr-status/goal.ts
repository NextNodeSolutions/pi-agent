import { activeGoal } from '#lib/goal/state.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { GoalSnapshot } from '#lib/goal/state.ts'

type PublishGoal = (shown: string) => Promise<void>

const openCount = (goal: GoalSnapshot): number =>
	goal.items.filter(task => !task.done).length

function openItems(ctx: ExtensionContext): string {
	const goal = activeGoal(ctx.sessionManager.getBranch())
	if (!goal) return ''
	const goals = [goal, ...(goal.paused ?? [])]
	const open = goals.reduce((sum, each) => sum + openCount(each), 0)
	const total = goals.reduce((sum, each) => sum + each.items.length, 0)
	return open === 0 ? '' : `${open} of ${total} items open`
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
