import { basename, resolve } from 'node:path'

import { runtimeFor } from '#lib/runtime/runtime.ts'
import { isTestPath, packageRunner } from '#lib/test-pace/paths.ts'
import { physicalPath } from '#lib/test-pace/physical-path.ts'
import {
	createdTestPaths,
	currentPaceRequest,
	explicitlyAllowsNewTests,
	explicitlyAllowsExistingTests,
	PACE_CREATED_ENTRY,
	PACE_GRANT_ENTRY,
} from '#lib/test-pace/request.ts'
import { changesTestSetup, proposedContent } from '#lib/test-pace/setup.ts'

import { shellStages } from './shell-segments.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'

const REFUSAL =
	'Test write refused. Call test_pace for exact new test paths and name the production bug or requirement. Existing tests, fixtures, configuration and end-to-end tests need human permission in this request. Report an existing test failure instead of changing its expectation. The human can use /test-pace allow <exact path> for explicit permission.'

function recordPaths(candidate: unknown, requestId: string): string[] {
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		Reflect.get(candidate, 'requestId') !== requestId
	)
		return []
	const paths: unknown = Reflect.get(candidate, 'paths')
	return Array.isArray(paths)
		? paths.filter(
				(path: unknown): path is string => typeof path === 'string',
			)
		: []
}

async function mayWrite(ctx: ExtensionContext, path: string): Promise<boolean> {
	const entries = ctx.sessionManager.getBranch()
	const request = currentPaceRequest(entries)
	if (!request) return false
	if (request.allowedPaths.includes(path)) return true
	if (isTestPath(path) && explicitlyAllowsExistingTests(request.text))
		return true
	const created = createdTestPaths(entries).includes(path)
	if ((await runtimeFor(path).exists(path)) && !created) return false
	if (isTestPath(path) && explicitlyAllowsNewTests(request.text)) return true
	return (
		Boolean(await packageRunner(path)) &&
		entries.some(
			entry =>
				entry.type === 'custom' &&
				entry.customType === PACE_GRANT_ENTRY &&
				recordPaths(entry.data, request.id).includes(path),
		)
	)
}

async function writePath(
	tool: string,
	input: unknown,
	cwd: string,
): Promise<string | undefined> {
	if (tool !== 'write' && tool !== 'edit') return undefined
	const path: unknown = Reflect.get(Object(input), 'path')
	if (typeof path !== 'string') return undefined
	const canonical = await physicalPath(resolve(cwd, path))
	if (basename(canonical) === 'package.json') {
		const runtime = runtimeFor(canonical)
		const before = (await runtime.exists(canonical))
			? (await runtime.readFile(canonical)).toString()
			: ''
		if (!changesTestSetup(before, proposedContent(tool, input, before)))
			return undefined
		return canonical
	}
	if (!isTestPath(path) && !isTestPath(canonical)) return undefined
	return canonical
}

function hasShellTestMutation(tool: string, input: unknown): boolean {
	if (tool !== 'bash' && tool !== 'host') return false
	const command: unknown = Reflect.get(Object(input), 'command')
	if (typeof command !== 'string') return false
	if (
		/^\s*git\s+(?:add|diff|status|log|show)\b[^;&|\n<>$`]*$/.test(
			command,
		) &&
		!/--output\b/.test(command)
	)
		return false
	return (
		command.split(/[\s'"=;|&<>]+/).some(word => isTestPath(word)) &&
		/(?:\b(?:rm|mv|cp|touch|tee|mkdir|rmdir|sed|perl|python\w*|node|ruby|apply_patch|patch)\b|>|--output\b|\bgit\s+(?:restore|checkout|reset|clean|apply|am|revert|cherry-pick|merge)\b)/.test(
			command,
		)
	)
}

async function isAuthorizedRemoval(
	input: unknown,
	ctx: ExtensionContext,
): Promise<boolean> {
	const command: unknown = Reflect.get(Object(input), 'command')
	if (typeof command !== 'string') return false
	const stages = shellStages(command)
	const [stage] = stages
	if (stages.length !== 1 || stage?.words[0] !== 'rm') return false
	const operands = stage.words
		.slice(1)
		.filter(word => word !== '--' && word !== '-f')
	if (!operands.length || operands.some(word => word.startsWith('-')))
		return false
	const request = currentPaceRequest(ctx.sessionManager.getBranch())
	if (!request) return false
	const paths = await Promise.all(
		operands.map(path => physicalPath(resolve(ctx.cwd, path))),
	)
	return (
		request.id === currentPaceRequest(ctx.sessionManager.getBranch())?.id &&
		paths.every(
			path =>
				request.allowedPaths.includes(path) ||
				(isTestPath(path) &&
					explicitlyAllowsExistingTests(request.text)),
		)
	)
}

export function registerTestWriteGuard(pi: ExtensionAPI): void {
	const pending = new Map<string, { path: string; requestId: string }>()
	pi.on('session_start', () => pending.clear())
	pi.on('session_tree', () => pending.clear())
	pi.on('tool_call', async (event, ctx) => {
		if (
			hasShellTestMutation(event.toolName, event.input) &&
			!(await isAuthorizedRemoval(event.input, ctx))
		)
			return {
				block: true,
				reason: `${REFUSAL} Use write/edit so exact-path permission can be checked.`,
			}
		const path = await writePath(event.toolName, event.input, ctx.cwd)
		if (!path) return undefined
		const requestId = currentPaceRequest(ctx.sessionManager.getBranch())?.id
		if (!(await mayWrite(ctx, path)))
			return { block: true, reason: REFUSAL }
		const request = currentPaceRequest(ctx.sessionManager.getBranch())
		if (request?.id !== requestId)
			return {
				block: true,
				reason: 'Human request changed during the test write check. Retry under the current request.',
			}
		if (request && !(await runtimeFor(path).exists(path)))
			pending.set(event.toolCallId, { path, requestId: request.id })
		return undefined
	})
	pi.on('tool_result', event => {
		const admitted = pending.get(event.toolCallId)
		pending.delete(event.toolCallId)
		if (admitted && !event.isError)
			pi.appendEntry(PACE_CREATED_ENTRY, {
				requestId: admitted.requestId,
				paths: [admitted.path],
			})
	})
}
