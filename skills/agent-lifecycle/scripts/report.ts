import { triedWorktrees } from './memory.ts'
import { titleOf } from './terminal.ts'

import type { Verdict } from './decide.ts'
import type { SweepReport } from './sweep.ts'

const TITLE_WIDTH = 34
const GAP = '  '
const DAY_MS = 86_400_000
const CLOCK = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short' })
const DAY_AND_CLOCK = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit',
})

function when(atMs: number, nowMs: number): string {
	return atMs - nowMs < DAY_MS
		? CLOCK.format(atMs)
		: DAY_AND_CLOCK.format(atMs)
}

function aligned(rows: readonly string[][]): string[] {
	const widths = rows.reduce<number[]>(
		(widest, cells) =>
			cells.map((cell, index) =>
				Math.max(widest[index] ?? 0, cell.length),
			),
		[],
	)
	return rows.map(cells =>
		cells
			.map((cell, index) =>
				index === cells.length - 1
					? cell
					: cell.padEnd(widths[index] ?? 0),
			)
			.join(GAP)
			.trimEnd(),
	)
}

function verdictRow(verdict: Verdict, due: string): string[] {
	return [
		`${GAP}${verdict.terminal.address}`,
		titleOf(verdict.terminal).slice(0, TITLE_WIDTH),
		verdict.kind,
		verdict.rule,
		due,
		verdict.reason,
	]
}

function section(heading: string, rows: readonly string[][]): string[] {
	return rows.length
		? ['', `${heading} (${rows.length})`, ...aligned(rows)]
		: []
}

function closingSection(report: SweepReport): string[] {
	if (report.mode === 'dry-run') {
		const eligible = report.verdicts.filter(
			verdict => verdict.action === 'close',
		)
		return section(
			'Would close',
			eligible.map(verdict => verdictRow(verdict, 'now')),
		)
	}
	return section(
		'Closed',
		report.closed.map(event => [
			`${GAP}${event.address}`,
			event.title.slice(0, TITLE_WIDTH),
			event.kind,
			event.reason,
		]),
	)
}

export function renderSweep(report: SweepReport): string {
	const nowMs = Date.now()
	const staying = report.verdicts.filter(verdict => verdict.action === 'keep')
	const later = staying.filter(verdict => verdict.closesAtMs !== null)
	const open = staying.filter(verdict => verdict.closesAtMs === null)
	const headline =
		report.mode === 'dry-run'
			? `Dry run at ${CLOCK.format(nowMs)}: ${report.verdicts.length} live terminals, nothing was closed.`
			: `Sweep at ${CLOCK.format(nowMs)}: ${report.verdicts.length} live terminals, ${report.closed.length} closed.`
	return [
		headline,
		...closingSection(report),
		...section(
			'Closes later',
			later.map(verdict =>
				verdictRow(verdict, when(verdict.closesAtMs ?? nowMs, nowMs)),
			),
		),
		...section(
			'Stays',
			open.map(verdict => verdictRow(verdict, '-')),
		),
		...section(
			'Worktrees removed',
			report.removedWorktrees.map(({ folder, detail }) => [
				`${GAP}${folder}`,
				detail,
			]),
		),
		...section(
			'Worktrees still on disk',
			triedWorktrees(report.heldWorktrees).map(([folder, entry]) => [
				`${GAP}${folder}`,
				entry.reason,
			]),
		),
	].join('\n')
}
