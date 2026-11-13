import { createHash } from 'node:crypto'

import { classifyTestPace } from '#lib/test-pace/decision.ts'
import { ineligibleTarget, targetPaths } from '#lib/test-pace/paths.ts'
import { physicalPath } from '#lib/test-pace/physical-path.ts'
import {
	createdTestPaths,
	currentPaceRequest,
	PACE_DECISION_ENTRY,
	PACE_GRANT_ENTRY,
	safePaceText,
} from '#lib/test-pace/request.ts'

import { testPaceParameters } from './schema.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { PaceDecision } from '#lib/test-pace/decision.ts'

type PaceTool = ToolDefinition<typeof testPaceParameters, unknown>

async function decide(
	ctx: ExtensionContext,
	intent: string,
	paths: string[],
	signal?: AbortSignal,
): Promise<PaceDecision> {
	const entries = ctx.sessionManager.getBranch()
	const request = currentPaceRequest(entries)
	if (!request)
		return {
			pace: 'none',
			reason: 'No recorded human request. Submit the task as human input.',
		}
	const root = await physicalPath(ctx.cwd)
	const reasons = await Promise.all(
		paths.map(path =>
			ineligibleTarget(root, path, createdTestPaths(entries)),
		),
	)
	const reason = reasons.find(Boolean)
	if (reason) return { pace: 'none', reason }
	return classifyTestPace(
		{
			request: request.text,
			intent: safePaceText(intent),
			paths,
		},
		signal,
	)
}

function cachedDecision(ctx: ExtensionContext, key: string): unknown {
	const saved = ctx.sessionManager
		.getBranch()
		.findLast(
			entry =>
				entry.type === 'custom' &&
				entry.customType === PACE_DECISION_ENTRY &&
				Reflect.get(Object(entry.data), 'key') === key,
		)
	if (saved?.type !== 'custom') return undefined
	return saved.data
}

async function executePace(
	pi: ExtensionAPI,
	args: Parameters<PaceTool['execute']>,
): ReturnType<PaceTool['execute']> {
	const [, params, signal, , ctx] = args
	const requestId = currentPaceRequest(ctx.sessionManager.getBranch())?.id
	const paths = await targetPaths(ctx.cwd, params.paths)
	const key = createHash('sha256')
		.update(JSON.stringify({ requestId, intent: params.intent, paths }))
		.digest('hex')
	const cached = cachedDecision(ctx, key)
	if (cached)
		return {
			content: [{ type: 'text', text: JSON.stringify(cached) }],
			details: cached,
		}
	const decision = await decide(ctx, params.intent, paths, signal)
	signal?.throwIfAborted()
	if (requestId !== currentPaceRequest(ctx.sessionManager.getBranch())?.id)
		throw new Error(
			'Human request changed during the decision. Call test_pace again.',
		)
	pi.appendEntry(PACE_DECISION_ENTRY, { key, ...decision, paths })
	if (decision.pace !== 'none')
		pi.appendEntry(PACE_GRANT_ENTRY, {
			requestId,
			paths,
			pace: decision.pace,
		})
	return {
		content: [
			{ type: 'text', text: JSON.stringify({ ...decision, paths }) },
		],
		details: decision,
	}
}

export function registerTestPaceTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: 'test_pace',
		label: 'test pace',
		description:
			'Before adding a bug or logic test, call with its named production defect or requirement and exact new test paths. Reads the human request itself. Free checks require an existing package runner and new unit/integration test files. One Jev verdict grants only those paths in this request. none means proceed without tests or ask the human. Load coding-tdd for bug or logic. Existing tests, fixtures, runner/config changes and end-to-end tests need human consent: ask in chat or with ask_user_question naming the paths and kind of edit; their yes is enough.',
		parameters: testPaceParameters,
		execute: (...args) => executePace(pi, args),
	})
}
