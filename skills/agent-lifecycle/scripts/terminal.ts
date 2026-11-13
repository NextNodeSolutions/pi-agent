import { TITLE_LABEL } from '#lib/ui/herdr-labels.ts'

export type Terminal = {
	address: string
	name: string | null
	parent: string | null
	state: string | null
	app: string | null
	statusMs: number
	turn: number
	cwd: string
	pid: number | null
	diesWithParent: boolean
	labels: Readonly<Record<string, string>>
}

export type TerminalClass =
	| 'principal'
	| 'auxiliary'
	| 'unreported'
	| 'helper'
	| 'thread'

export const TAB_LABEL = 'herdr.tab'
const PLACE_LABEL = 'where'

export function titleOf(terminal: Terminal): string {
	return (
		terminal.labels[TITLE_LABEL] ??
		terminal.name ??
		terminal.labels[PLACE_LABEL] ??
		terminal.address
	)
}
