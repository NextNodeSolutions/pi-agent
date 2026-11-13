import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'

import { GOAL_LABEL, WAITING_LABEL } from '#lib/ui/herdr-labels.ts'

import { labelTerminal, startTerminal, terminalAt } from './hc.ts'
import { appendEvent, readEvents, reopenAfter } from './journal.ts'
import { loadPolicy } from './policy.ts'
import { TAB_LABEL } from './terminal.ts'

import type { ClosedEvent, JournalEvent } from './journal.ts'
import type { Policy } from './policy.ts'

const execute = promisify(execFile)
const RENAME_TIMEOUT_MS = 10_000
const LOGIN_SHELL = ['zsh', '-lc', 'exec "$0" "$@"']

export type Reopened = { from: string; as: string; isAlreadyOpen: boolean }

function lastClosed(
	reference: string,
	events: readonly JournalEvent[],
): ClosedEvent {
	const wanted = reference.toLowerCase()
	const closed = events.findLast(
		event =>
			event.event === 'closed' &&
			[event.address, event.name, event.title].some(
				known => known?.toLowerCase() === wanted,
			),
	)
	if (closed?.event !== 'closed')
		throw new Error(
			`No closed terminal is called ${reference}. \`agent-lifecycle closed\` lists them with their address.`,
		)
	return closed
}

async function stillOpen(
	closed: ClosedEvent,
	events: readonly JournalEvent[],
): Promise<string | null> {
	const reopened = reopenAfter(events, closed)
	if (!reopened) return null
	if ((await terminalAt(reopened.as)) === null) return null
	return reopened.as
}

function restoredLabels(
	closed: ClosedEvent,
	tab: string | null,
	policy: Policy,
): string[] {
	const { seen, keep } = policy.labels
	const dropped = new Set([seen, keep, WAITING_LABEL, GOAL_LABEL, TAB_LABEL])
	const kept = Object.entries(closed.labels).filter(
		([key]) => !dropped.has(key),
	)
	const restored = tab === null ? kept : [...kept, [TAB_LABEL, tab]]
	return restored.flatMap(([key, value]) => ['--label', `${key}=${value}`])
}

async function ownerArguments(closed: ClosedEvent): Promise<string[]> {
	const owner = closed.parent ? await terminalAt(closed.parent) : null
	return owner ? ['--parent', owner.address] : ['--no-parent', '--keep']
}

async function nameTab(tab: string, title: string): Promise<void> {
	try {
		await execute(
			'herdr-app',
			['do', 'tab.rename', '--id', tab, '--name', title],
			{ timeout: RENAME_TIMEOUT_MS },
		)
	} catch {
		return
	}
}

// One conversation, one process: a second reopen returns the terminal the first one started.
export async function reopen(
	reference: string,
	policyFile: string | null,
): Promise<Reopened> {
	const policy = loadPolicy(policyFile)
	const events = readEvents()
	const closed = lastClosed(reference, events)
	const { recipe } = closed
	if (recipe === null)
		throw new Error(
			`${closed.title} left nothing to resume. \`hc read ${closed.address}\` prints its last screen.`,
		)
	const open = await stillOpen(closed, events)
	if (open !== null)
		return { from: closed.address, as: open, isAlreadyOpen: true }
	if (!existsSync(recipe.cwd))
		throw new Error(
			`${closed.title} worked in ${recipe.cwd}, which is gone. Recreate that folder (\`git worktree add\` for a worktree), then reopen.`,
		)
	const tab =
		TAB_LABEL in closed.labels
			? `tb${randomUUID().replaceAll('-', '')}`
			: null
	const address = await startTerminal([
		...(await ownerArguments(closed)),
		...(closed.name === null ? [] : ['--name', closed.name]),
		'--cwd',
		recipe.cwd,
		...restoredLabels(closed, tab, policy),
		'--',
		...LOGIN_SHELL,
		...recipe.argv,
	])
	appendEvent({
		event: 'reopened',
		atMs: Date.now(),
		address: closed.address,
		as: address,
	})
	if (tab !== null) await nameTab(tab, closed.title)
	return { from: closed.address, as: address, isAlreadyOpen: false }
}

export async function keepOpen(
	terminal: string,
	isKept: boolean,
	policyFile: string | null,
): Promise<void> {
	const policy = loadPolicy(policyFile)
	await labelTerminal(
		terminal,
		policy.labels.keep,
		isKept ? 'kept by hand' : '',
	)
}
