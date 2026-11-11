/**
 * User-requested goal re-evaluation: delete and revise.
 *
 * route-events.ts records genuine human input with its goal revision. That
 * record alone grants no permission: the human must be shown to have requested
 * this change. One Jev coverage check settles it when TYPESAFE_API_KEY is set;
 * without the key, or when Jev sees no coverage, the human confirms the exact
 * change in a dialog. A headless run without Jev cannot confirm and leaves the
 * goal unchanged. The record stands until the next human prompt replaces it; a
 * goal that moves during the check aborts the edit. Ordinary completion records
 * never need this destructive-edit gate.
 */
import { activeGoal, GOAL_STATE_ENTRY, manageMarker } from '#lib/goal/state.ts'
import { askChoice, isJevConfigured } from '#lib/jev/client.ts'

import { deleteGoal, revisePlan } from './manage-edits.ts'
import { showGoalStatus } from './status.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { GoalManageMarker, GoalState } from '#lib/goal/state.ts'
import type { ChoiceQuestion } from '#lib/jev/client.ts'
import type { GoalParameters } from './schema.ts'

function assertMarker(ctx: ExtensionContext): GoalManageMarker {
	const marker = manageMarker(ctx.sessionManager.getBranch())
	if (!marker)
		throw new Error(
			'goal delete/revise requires recorded human input and an explicit re-evaluation request. Ask the human to state it; never restructure a goal to fit ongoing work.',
		)
	if (marker.truncated)
		throw new Error(
			'The human request was truncated; delete/revise needs a concise explicit request. Nothing was changed.',
		)
	return marker
}

type ManageProps = {
	action: 'delete' | 'revise'
	items?: string[] | undefined
	reason?: string | undefined
}

type ChangeDescription = {
	action: ManageProps['action']
	effect: string
	items?: string[] | undefined
	reason?: string | undefined
}

function describeChange(props: ManageProps): ChangeDescription {
	if (props.action === 'delete')
		return {
			action: 'delete',
			effect: 'clear the whole active checklist, including completed history',
			reason: props.reason,
		}
	return {
		action: 'revise',
		effect: 'replace the remaining plan items with the listed ones; unlisted completed work is preserved',
		items: props.items,
		reason: props.reason,
	}
}

const CLAIM_QUESTION: ChoiceQuestion = {
	instructions:
		'Judge whether state.proposedChange is exactly the goal re-evaluation the human requested in state.humanRequest, relative to state.activeGoal. delete must mean clearing the whole checklist; revise replaces the remaining plan items with its list. Items the request does not mention may change only when the requested outcome clearly covers them ("clear everything", "start over", "shrink the plan"). Decline when the request does not clearly cover this specific change.',
	criteria: {
		covered:
			'The proposed change performs exactly the requested re-evaluation; every removed, rewritten or added item is covered by the human request.',
		differs:
			'The proposed change removes, adds or rewrites items beyond what the human request covers, or does not clearly match it.',
	},
}

/** Prompt excerpt carried into dialogs and the applied record, bounded for tool output. */
const REPORT_PROMPT_CHARS = 120

/** Undefined when Jev confirms coverage; otherwise why the automatic check did not authorise the change. */
async function coverageGap(input: {
	marker: GoalManageMarker
	current: GoalState
	change: ChangeDescription
	signal: AbortSignal | undefined
}): Promise<string | undefined> {
	const { marker, current, change, signal } = input
	if (!isJevConfigured())
		return 'TYPESAFE_API_KEY is not set, so the automatic coverage check could not run'
	const verdict = await askChoice(
		{
			activeGoal: {
				revision: current.revision,
				request: current.request,
				items: current.items.map(({ id, text, done, kind }) => ({
					id,
					text,
					done,
					kind,
				})),
			},
			humanRequest: marker.prompt,
			proposedChange: change,
		},
		CLAIM_QUESTION,
		{ signal },
	)
	if (signal?.aborted)
		throw new Error(
			'The re-evaluation check was cancelled; nothing was changed.',
		)
	if (verdict.choice === 'covered') return undefined
	return `the automatic coverage check did not match this change to the latest human request (${verdict.choice}, confidence ${verdict.confidence})`
}

async function confirmWithHuman(input: {
	ctx: ExtensionContext
	marker: GoalManageMarker
	change: ChangeDescription
	gap: string
}): Promise<void> {
	const { ctx, marker, change, gap } = input
	if (!ctx.hasUI)
		throw new Error(
			`goal ${change.action} refused: ${gap}, and no dialog is available to ask the human. Match the request exactly, or ask the human for a clearer one.`,
		)
	const lines = [
		`Request: "${marker.prompt.slice(0, REPORT_PROMPT_CHARS)}"`,
		`Change: ${change.effect}.`,
		...(change.items?.length
			? [
					'Remaining plan:',
					...change.items.map(planText => `- ${planText}`),
				]
			: []),
		...(change.reason ? [`Agent reason: ${change.reason}`] : []),
		'',
		`Asking you because ${gap}.`,
		`Apply this ${change.action}?`,
	]
	const accepted = await ctx.ui.confirm(
		`Goal ${change.action}`,
		lines.join('\n'),
	)
	if (!accepted)
		throw new Error(
			`goal ${change.action} declined by the human in the dialog; nothing was changed.`,
		)
}

export type ManageOutcome = {
	next: GoalState | undefined
	report: string
}

function applyChange(input: {
	action: 'delete' | 'revise'
	current: GoalState
	ctx: ExtensionContext
	items: string[] | undefined
}): GoalState {
	const { action, current, ctx, items } = input
	const latest = activeGoal(ctx.sessionManager.getBranch())
	if (latest?.revision !== current.revision)
		throw new Error(
			`The goal changed during the check (now revision ${latest?.revision ?? 'none'}); the routed authorisation no longer applies; ask the human.`,
		)
	const next =
		action === 'delete'
			? deleteGoal(latest)
			: revisePlan(latest, items ?? [])
	return next
}

export async function executeManage(input: {
	pi: ExtensionAPI
	ctx: ExtensionContext
	current: GoalState | undefined
	params: GoalParameters
	signal: AbortSignal | undefined
}): Promise<ManageOutcome> {
	const { pi, ctx, current, params, signal } = input
	if (params.action !== 'delete' && params.action !== 'revise')
		throw new Error(
			`goal ${params.action} does not belong to the re-evaluation flow.`,
		)
	const { action } = params
	if (!current) throw new Error(`goal ${action} needs an active goal.`)
	const marker = assertMarker(ctx)
	const sessionId = ctx.sessionManager.getSessionId()
	const change = describeChange({
		action,
		items: params.items,
		reason: params.reason,
	})
	const gap = await coverageGap({ marker, current, change, signal })
	if (gap) await confirmWithHuman({ ctx, marker, change, gap })
	if (sessionId !== ctx.sessionManager.getSessionId())
		throw new Error(
			'Session switched during the re-evaluation check; retry in the original session.',
		)
	const next = applyChange({
		action,
		current,
		ctx,
		items: params.items,
	})
	pi.appendEntry(GOAL_STATE_ENTRY, next)
	showGoalStatus(ctx, next)
	const authority = gap
		? 'the human confirmed it in a dialog'
		: 'the coverage check matched the latest human request'
	return {
		next,
		report: `\nRe-evaluation ${action} applied; ${authority} ("${marker.prompt.slice(0, REPORT_PROMPT_CHARS)}").`,
	}
}
