import { basename, resolve } from 'node:path'

import { runtimeFor } from '#lib/runtime/runtime.ts'
import { consentsAllowing } from '#lib/test-pace/consent.ts'
import { classifyOperation } from '#lib/test-pace/operation.ts'
import { isTestPathWithin, packageRunner } from '#lib/test-pace/paths.ts'
import { physicalPath } from '#lib/test-pace/physical-path.ts'
import {
	createdTestPaths,
	currentPaceRequest,
	grantedTestPaths,
	PACE_CREATED_ENTRY,
} from '#lib/test-pace/request.ts'
import { changesTestSetup, proposedContent } from '#lib/test-pace/setup.ts'

import { shellWrites } from './shell-writes.ts'
import { consentReader } from './test-consent.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { Judgment } from '#lib/test-pace/consent.ts'
import type { PaceRequest } from '#lib/test-pace/request.ts'

const REFUSAL =
	"Test write refused. For a new bug or logic test, call test_pace with its exact paths and the production bug or requirement it names. Other test edits (existing tests, fixtures, test configuration, end-to-end tests) need the human's consent: ask in chat or with ask_user_question, naming the files or directories and the kind of edit, then retry after their yes; never ask them to type a command. A relayed consent counts only when the human's answer in the sender's Pi session names this terminal's address or the relay quotes it. Report an existing test failure instead of changing its expectation."
const UNRESOLVED_REFUSAL = `${REFUSAL} This command changes directory or names tests by pattern, so its targets cannot be matched to a permission: use write/edit, or run it from the session directory on exact paths.`
const GLOB = /[*?[\]{}]/

type Target = { path: string; setup: boolean }
/** Unknown shell targets cannot prove that a scoped consent covers every effect. */
type Write = Target[] | 'unresolved'
type Admission = { requestId: string; paths: string[] }
type Check = {
	ctx: ExtensionContext
	request: PaceRequest | undefined
	consents: () => Promise<Judgment[]>
	operation: string
}

async function fileWrite(
	tool: string,
	input: unknown,
	cwd: string,
): Promise<Target[] | undefined> {
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
		return [{ path: canonical, setup: true }]
	}
	const isTest =
		isTestPathWithin(cwd, lexical) ||
		(canonical !== lexical &&
			isTestPathWithin(await physicalPath(cwd), canonical))
	if (!isTest) return undefined
	return [{ path: canonical, setup: false }]
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
	if (writes.changesDirectory || paths.some(path => GLOB.test(path)))
		return 'unresolved'
	return Promise.all(
		paths.map(async path => ({
			path: await physicalPath(resolve(cwd, path)),
			setup: false,
		})),
	)
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

async function isPresent(
	ctx: ExtensionContext,
	path: string,
): Promise<boolean> {
	return (
		(await runtimeFor(path).exists(path)) &&
		!createdTestPaths(ctx.sessionManager.getBranch()).includes(path)
	)
}

async function isGranted(
	ctx: ExtensionContext,
	request: PaceRequest | undefined,
	path: string,
): Promise<boolean> {
	if (!request) return false
	return (
		grantedTestPaths(ctx.sessionManager.getBranch(), request.id).includes(
			path,
		) && Boolean(await packageRunner(path))
	)
}

async function admits(check: Check, target: Target): Promise<boolean> {
	const { ctx, request } = check
	const present = await isPresent(ctx, target.path)
	if (
		!target.setup &&
		!present &&
		(await isGranted(ctx, request, target.path))
	)
		return true
	const allowing = consentsAllowing(
		await check.consents(),
		target.path,
		target.setup || !present ? 'new' : 'existing',
	)
	const decisions = await Promise.all(
		allowing.map(consent => classifyOperation(consent, check.operation)),
	)
	return decisions.some(decision => decision.allowed)
}

async function newPaths(targets: readonly Target[]): Promise<string[]> {
	const created = await Promise.all(
		targets.map(async target =>
			(await runtimeFor(target.path).exists(target.path))
				? []
				: [target.path],
		),
	)
	return created.flat()
}

export function registerTestWriteGuard(pi: ExtensionAPI): void {
	const pending = new Map<string, Admission>()
	const readConsents = consentReader(pi)
	pi.on('session_start', () => pending.clear())
	pi.on('session_tree', () => pending.clear())
	pi.on('tool_call', async (event, ctx) => {
		const write = await requestedWrite(event.toolName, event.input, ctx.cwd)
		if (!write) return undefined
		if (write === 'unresolved')
			return { block: true, reason: UNRESOLVED_REFUSAL }
		const request = currentPaceRequest(ctx.sessionManager.getBranch())
		const reading: { consents?: Promise<Judgment[]> } = {}
		const consents = (): Promise<Judgment[]> =>
			(reading.consents ??= readConsents(ctx))
		const created = await newPaths(write)
		const operation = JSON.stringify({
			tool: event.toolName,
			input: event.input,
		})
		const check = { ctx, request, consents, operation }
		const admitted = await Promise.all(
			write.map(target => admits(check, target)),
		)
		if (!admitted.every(Boolean)) return { block: true, reason: REFUSAL }
		if (
			currentPaceRequest(ctx.sessionManager.getBranch())?.id !==
			request?.id
		)
			return {
				block: true,
				reason: 'Human request changed during the test write check. Retry under the current request.',
			}
		if (request && created.length)
			pending.set(event.toolCallId, {
				requestId: request.id,
				paths: created,
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
