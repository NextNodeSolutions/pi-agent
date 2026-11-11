/**
 * Where the checklist sits in a model request. Each checklist is frozen as the
 * goal stood at its anchor, so two requests of one turn differ only by appended
 * rounds: Magpie classifies a turn from the prompt ending its first request and
 * keeps that model while the earlier messages stay unchanged, and the provider's
 * prompt cache extends instead of being rewritten. After the latest compaction,
 * its summary and each prompt carry the checklist just before them, and tool
 * results at a fixed interval carry it inside, which keeps the open items near
 * the end of a long turn.
 */
import { goalContextText, storedGoal } from '#lib/goal/state.ts'

import type {
	ContextEvent,
	SessionEntry,
} from '@earendil-works/pi-coding-agent'
import type { GoalState } from '#lib/goal/state.ts'

const GOAL_CONTEXT_TYPE = 'goal-context'
const REMINDER_TAG = 'goal-checklist'
const TOOL_RESULTS_PER_REMINDER = 10

type ContextMessage = ContextEvent['messages'][number]
type ToolResultMessage = Extract<ContextMessage, { role: 'toolResult' }>

type ChecklistPlan = {
	atCompaction: GoalState | undefined
	beforePrompt: Map<number, GoalState>
	inToolResult: Map<string, GoalState>
}

function planFrom(atCompaction: GoalState | undefined): ChecklistPlan {
	return { atCompaction, beforePrompt: new Map(), inToolResult: new Map() }
}

function withItems(goal: GoalState | undefined): GoalState | undefined {
	if (!goal?.items.length) return undefined
	return goal
}

function planChecklists(branch: SessionEntry[]): ChecklistPlan {
	let plan = planFrom(undefined)
	let goal: GoalState | undefined
	let toolResults = 0
	for (const entry of branch) {
		goal = withItems(storedGoal(entry) ?? goal)
		if (entry.type === 'compaction') {
			plan = planFrom(goal)
			toolResults = 0
			continue
		}
		if (entry.type !== 'message' || !goal) continue
		const { message } = entry
		if (message.role === 'user') {
			plan.beforePrompt.set(message.timestamp, goal)
			toolResults = 0
			continue
		}
		if (message.role !== 'toolResult') continue
		toolResults += 1
		if (toolResults % TOOL_RESULTS_PER_REMINDER === 0)
			plan.inToolResult.set(message.toolCallId, goal)
	}
	return plan
}

function anchoredGoal(
	plan: ChecklistPlan,
	message: ContextMessage,
): GoalState | undefined {
	if (message.role === 'compactionSummary') return plan.atCompaction
	if (message.role === 'user') return plan.beforePrompt.get(message.timestamp)
	return undefined
}

function checklistBefore(
	message: ContextMessage,
	goal: GoalState,
): ContextMessage {
	return {
		role: 'custom',
		customType: GOAL_CONTEXT_TYPE,
		content: goalContextText(goal),
		display: false,
		timestamp: message.timestamp,
	}
}

function withReminder(
	message: ToolResultMessage,
	goal: GoalState,
): ToolResultMessage {
	return {
		...message,
		content: [
			...message.content,
			{
				type: 'text',
				text: `<${REMINDER_TAG}>\n${goalContextText(goal)}\n</${REMINDER_TAG}>`,
			},
		],
	}
}

export function withGoalChecklists(
	messages: ContextMessage[],
	branch: SessionEntry[],
): ContextMessage[] {
	const plan = planChecklists(branch)
	return messages.flatMap(message => {
		const anchored = anchoredGoal(plan, message)
		if (anchored) return [checklistBefore(message, anchored), message]
		if (message.role !== 'toolResult') return [message]
		const reminded = plan.inToolResult.get(message.toolCallId)
		return [reminded ? withReminder(message, reminded) : message]
	})
}
