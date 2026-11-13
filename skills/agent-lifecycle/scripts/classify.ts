import { TAB_LABEL } from './terminal.ts'

import type { Policy } from './policy.ts'
import type { Terminal, TerminalClass } from './terminal.ts'

const MACHINE_SEPARATOR = '/'

export type Subject = {
	terminal: Terminal
	kind: TerminalClass
	ownerReference: string | null
	owner: Terminal | null
}

export const isRemote = (terminal: Terminal): boolean =>
	terminal.address.includes(MACHINE_SEPARATOR)

// The Command Center names a thread's monitor, shell and editor `<kind>-<thread address>` and starts them outside any tab.
function isAuxiliary(
	terminal: Terminal,
	terminals: readonly Terminal[],
): boolean {
	if (terminal.parent !== null || TAB_LABEL in terminal.labels) return false
	return terminals.some(
		other =>
			other.address !== terminal.address &&
			terminal.name?.endsWith(`-${other.address}`),
	)
}

function classOf(
	terminal: Terminal,
	terminals: readonly Terminal[],
	policy: Policy,
): TerminalClass {
	if (terminal.name === policy.principalName) return 'principal'
	if (isAuxiliary(terminal, terminals)) return 'auxiliary'
	if (terminal.state === null || isRemote(terminal)) return 'unreported'
	return terminal.parent === null ? 'thread' : 'helper'
}

export const ownerReferenceOf = (
	terminal: Terminal,
	policy: Policy,
): string | null =>
	terminal.parent ?? terminal.labels[policy.labels.owner] ?? null

export function toSubject(
	terminal: Terminal,
	terminals: readonly Terminal[],
	policy: Policy,
): Subject {
	const ownerReference = ownerReferenceOf(terminal, policy)
	const owner = terminals.find(
		candidate =>
			candidate.address === ownerReference ||
			(candidate.name !== null && candidate.name === ownerReference),
	)
	return {
		terminal,
		kind: classOf(terminal, terminals, policy),
		ownerReference,
		owner: owner ?? null,
	}
}
