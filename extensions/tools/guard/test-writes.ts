import { basename, resolve } from 'node:path'

import { runtimeFor } from '#lib/runtime/runtime.ts'
import {
	coversPath,
	isTestPathWithin,
	packageRunner,
} from '#lib/test-pace/paths.ts'
import { classifyTestPermission } from '#lib/test-pace/permission.ts'
import { physicalPath } from '#lib/test-pace/physical-path.ts'
import {
	createdTestPaths,
	currentPaceRequest,
	grantedTestPaths,
	PACE_CREATED_ENTRY,
	PACE_PERMISSION_ENTRY,
	recordedPermission,
} from '#lib/test-pace/request.ts'
import { changesTestSetup, proposedContent } from '#lib/test-pace/setup.ts'

import { shellWrites } from './shell-writes.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { TestPermission } from '#lib/test-pace/permission.ts'
import type { PaceRequest } from '#lib/test-pace/request.ts'

const REFUSAL =
	'Test write refused. For a new bug or logic test, call test_pace with its exact paths and the production bug or requirement it names. Existing tests, fixtures, test configuration and end-to-end tests need the human to ask for them in this request, or to run /test-pace allow <file or directory>. Report an existing test failure instead of changing its expectation.'
const UNRESOLVED_REFUSAL = `${REFUSAL} This command changes directory or names tests by pattern, so its targets cannot be matched to a permission: use write/edit, or run it from the session directory on exact paths.`
const GLOB = /[*?[\]{}]/

type Target = { path: string; setup: boolean }
type Write = { targets: Target[]; resolvable: boolean }
type Admission = { requestId: string; paths: string[] }
type PermissionReader = (
	ctx: ExtensionContext,
	request: PaceRequest,
) => Promise<TestPermission>
type Check = {
	ctx: ExtensionContext
	request: PaceRequest
	write: Write
	readPermission: PermissionReader
}

async function fileWrite(
	tool: string,
	input: unknown,
	cwd: string,
): Promise<Write | undefined> {
	const path: unknown = Reflect.get(Object(input), 'path')
	if (typeof path !== 'string') return undefined
	const lexical = resolve(cwd, path)
	const canonical = await physicalPath(lexical)
	if (basename(canonical) === 'package.json') {
		const runtime = runtimeFor(canonical)
		const before = (await runtime.exists(canonical))
			? (await runtime.readFile(canonical)).toString()
			: ''
		if (!changesTestSetup(before, proposedContent(tool, input, before)))
			return undefined
		return { targets: [{ path: canonical, setup: true }], resolvable: true }
	}
	const isTest =
		isTestPathWithin(cwd, lexical) ||
		(canonical !== lexical &&
			isTestPathWithin(await physicalPath(cwd), canonical))
	if (!isTest) return undefined
	return { targets: [{ path: canonical, setup: false }], resolvable: true }
}

async function shellWrite(
	input: unknown,
	cwd: string,
): Promise<Write | undefined> {
	const command: unknown = Reflect.get(Object(input), 'command')
	if (typeof command !== 'string') return undefined
	const writes = shellWrites(command)
	const runtime = runtimeFor(cwd)
	const present = await Promise.all(
		writes.ifExisting
			.filter(path => isTestPathWithin(cwd, path))
			.map(async path =>
				(await runtime.exists(resolve(cwd, path))) ? [path] : [],
			),
	)
	const paths = [
		...writes.certain.filter(path => isTestPathWithin(cwd, path)),
		...present.flat(),
	]
	if (!paths.length) return undefined
	const resolvable =
		!writes.changesDirectory && !paths.some(path => GLOB.test(path))
	return {
		targets: resolvable
			? await Promise.all(
					paths.map(async path => ({
						path: await physicalPath(resolve(cwd, path)),
						setup: false,
					})),
				)
			: paths.map(path => ({ path, setup: false })),
		resolvable,
	}
}

async function requestedWrite(
	tool: string,
	input: unknown,
	cwd: string,
): Promise<Write | undefined> {
	if (tool === 'write' || tool === 'edit') return fileWrite(tool, input, cwd)
	if (tool === 'bash' || tool === 'host') return shellWrite(input, cwd)
	return undefined
}

async function readHumanPermission(
	pi: ExtensionAPI,
	request: PaceRequest,
): Promise<TestPermission> {
	const decision = await classifyTestPermission(request.text)
	if (decision.answer)
		pi.appendEntry(PACE_PERMISSION_ENTRY, {
			requestId: request.id,
			permission: decision.permission,
			choice: decision.answer.choice,
			confidence: decision.answer.confidence,
		})
	return decision.permission
}

function permissionReader(pi: ExtensionAPI): PermissionReader {
	const reading = new Map<string, Promise<TestPermission>>()
	return async (ctx, request) => {
		if (request.delegated) return 'none'
		const recorded = recordedPermission(
			ctx.sessionManager.getBranch(),
			request.id,
		)
		if (recorded) return recorded
		const pending =
			reading.get(request.id) ?? readHumanPermission(pi, request)
		reading.set(request.id, pending)
		return pending
	}
}

async function isPresent(
	ctx: ExtensionContext,
	path: string,
): Promise<boolean> {
	return (
		(await runtimeFor(path).exists(path)) &&
		!createdTestPaths(ctx.sessionManager.getBranch()).includes(path)
	)
}

async function admits(check: Check, target: Target): Promise<boolean> {
	const { ctx, request, write, readPermission } = check
	if (!write.resolvable)
		return (await readPermission(ctx, request)) === 'existing'
	if (coversPath(request.allowedPaths, target.path)) return true
	const present = await isPresent(ctx, target.path)
	const granted =
		!target.setup &&
		!present &&
		grantedTestPaths(ctx.sessionManager.getBranch(), request.id).includes(
			target.path,
		) &&
		Boolean(await packageRunner(target.path))
	if (granted) return true
	const permission = await readPermission(ctx, request)
	return (
		permission === 'existing' ||
		(permission === 'new' && (target.setup || !present))
	)
}

export function registerTestWriteGuard(pi: ExtensionAPI): void {
	const pending = new Map<string, Admission>()
	const readPermission = permissionReader(pi)
	pi.on('session_start', () => pending.clear())
	pi.on('session_tree', () => pending.clear())
	pi.on('tool_call', async (event, ctx) => {
		const write = await requestedWrite(event.toolName, event.input, ctx.cwd)
		if (!write) return undefined
		const reason = write.resolvable ? REFUSAL : UNRESOLVED_REFUSAL
		const request = currentPaceRequest(ctx.sessionManager.getBranch())
		if (!request) return { block: true, reason }
		const created = write.resolvable
			? await Promise.all(
					write.targets.map(async target =>
						(await runtimeFor(target.path).exists(target.path))
							? []
							: [target.path],
					),
				)
			: []
		const admitted = await Promise.all(
			write.targets.map(target =>
				admits({ ctx, request, write, readPermission }, target),
			),
		)
		if (!admitted.every(Boolean)) return { block: true, reason }
		if (
			currentPaceRequest(ctx.sessionManager.getBranch())?.id !==
			request.id
		)
			return {
				block: true,
				reason: 'Human request changed during the test write check. Retry under the current request.',
			}
		if (created.flat().length)
			pending.set(event.toolCallId, {
				requestId: request.id,
				paths: created.flat(),
			})
		return undefined
	})
	pi.on('tool_result', event => {
		const admitted = pending.get(event.toolCallId)
		pending.delete(event.toolCallId)
		if (admitted && !event.isError)
			pi.appendEntry(PACE_CREATED_ENTRY, admitted)
	})
}
