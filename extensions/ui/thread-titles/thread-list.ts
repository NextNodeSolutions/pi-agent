/** Thread titles as the Command Center lists them, read from hc's terminal API in one call. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { TITLE_LABEL } from '#lib/ui/herdr-labels.ts'
import { reflectMember } from '#lib/ui/pi-members.ts'

const execFileAsync = promisify(execFile)
const HC_TIMEOUT_MS = 2000
const LIST_REQUEST = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'terminal.list', params: {} })}\n`
const PRINCIPAL_CHAT = 'principal-chat'
const AUXILIARY_NAME = /^(?:monitor|shell|nvim)-/u
const ANSWER_EXCERPT_CHARS = 200

/** Mirrors isThread in ~/.config/herdr-app/mods/command-center/threads.js, so a styled title is one the list shows. */
function isListedThread(terminal: unknown): boolean {
	const name = reflectMember(terminal, 'name')
	return (
		reflectMember(terminal, 'state') === 'live' &&
		Boolean(reflectMember(terminal, 'status')) &&
		name !== PRINCIPAL_CHAT &&
		!(typeof name === 'string' && AUXILIARY_NAME.test(name))
	)
}

function labelledTitle(terminal: unknown): string {
	const title = reflectMember(reflectMember(terminal, 'labels'), TITLE_LABEL)
	return typeof title === 'string' ? title.trim() : ''
}

export function listedThreadTitles(response: unknown): string[] {
	const terminals = reflectMember(
		reflectMember(response, 'result'),
		'terminals',
	)
	if (!Array.isArray(terminals))
		throw new Error(
			`hc terminal.list answered without result.terminals: ${JSON.stringify(response).slice(0, ANSWER_EXCERPT_CHARS)}`,
		)
	return terminals.filter(isListedThread).map(labelledTitle).filter(Boolean)
}

export async function readThreadTitles(): Promise<string[]> {
	const pending = execFileAsync('hc', ['connect'], { timeout: HC_TIMEOUT_MS })
	pending.child.stdin?.end(LIST_REQUEST)
	const { stdout } = await pending
	return listedThreadTitles(JSON.parse(stdout))
}
