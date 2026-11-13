import { mkdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { readEvents, reopenAfter } from './journal.ts'
import { readMemory, triedWorktrees } from './memory.ts'
import { stateDirectory, writeAtomically } from './storage.ts'
import { reopenCommand } from './trace.ts'

import type { ClosedEvent, JournalEvent } from './journal.ts'
import type { Memory } from './memory.ts'

const PAGE_FILE = 'closed.md'
const WHEN = new Intl.DateTimeFormat('en-GB', {
	dateStyle: 'medium',
	timeStyle: 'short',
})

export const closedPagePath = (): string => join(stateDirectory(), PAGE_FILE)

const cell = (text: string): string =>
	text.replaceAll('|', '\\|').replaceAll('\n', ' ')

const row = (cells: readonly string[]): string =>
	`| ${cells.map(cell).join(' | ')} |`

function table(headings: readonly string[], rows: string[][]): string[] {
	return [row(headings), row(headings.map(() => '---')), ...rows.map(row)]
}

function nextStep(
	closed: ClosedEvent,
	events: readonly JournalEvent[],
): string {
	const reopened = reopenAfter(events, closed)
	if (reopened?.as === closed.address) return 'still open: ending it failed'
	if (reopened) return `reopened as ${reopened.as}`
	return closed.recipe
		? `\`${reopenCommand(closed.address)}\``
		: `nothing to resume; \`hc read ${closed.address}\` prints its last screen`
}

function closedRow(
	event: JournalEvent,
	events: readonly JournalEvent[],
): string[] {
	const when = WHEN.format(event.atMs)
	if (event.event === 'reopened') return []
	if (event.event === 'worktree-removed')
		return [when, event.folder, 'worktree', event.detail, '', '']
	const trace = event.trace
		? `[trace](${relative(stateDirectory(), event.trace)})`
		: ''
	return [
		when,
		`${event.address} ${event.title}`,
		event.kind,
		event.reason,
		trace,
		nextStep(event, events),
	]
}

function heldRows(held: Memory['heldWorktrees']): string[][] {
	return triedWorktrees(held).map(([folder, entry]) => [
		folder,
		entry.owner,
		entry.reason,
		WHEN.format(entry.triedMs),
	])
}

function heldSection(held: Memory['heldWorktrees']): string[] {
	const rows = heldRows(held)
	if (!rows.length) return []
	return [
		'',
		'## Worktrees still on disk',
		'',
		...table(['Folder', 'Started by', 'Why it stays', 'Last tried'], rows),
	]
}

export function closedPage(
	events: readonly JournalEvent[],
	held: Memory['heldWorktrees'],
): string {
	const rows = events
		.toReversed()
		.map(event => closedRow(event, events))
		.filter(cells => cells.length)
	return [
		'# Closed agent terminals',
		'',
		'What the lifecycle policy closed, newest first. `agent-lifecycle keep <terminal>` keeps one open; `agent-lifecycle policy` prints the rules.',
		'',
		...(rows.length
			? table(
					['Closed', 'Terminal', 'Class', 'Why', 'Trace', 'Next'],
					rows,
				)
			: ['Nothing closed yet.']),
		...heldSection(held),
		'',
	].join('\n')
}

export function writeClosedPage(): string {
	mkdirSync(stateDirectory(), { recursive: true })
	const path = closedPagePath()
	writeAtomically(path, closedPage(readEvents(), readMemory().heldWorktrees))
	return path
}
