import { readLabel } from '#lib/ui/herdr-labels.ts'

import { MINUTE_MS } from './policy.ts'

import type { Subject } from './classify.ts'
import type { Memory } from './memory.ts'
import type { Policy } from './policy.ts'
import type { Terminal } from './terminal.ts'

const NEVER_SEEN = -1
const STUCK_STATES = ['blocked', 'error']

type Witness = { memory: Memory; policy: Policy; nowMs: number }

export const isOrphan = (subject: Subject): boolean =>
	subject.kind === 'helper' && subject.owner === null

export function leaseMs(subject: Subject, policy: Policy): number {
	if (subject.kind === 'thread') return policy.leaseMinutes.thread * MINUTE_MS
	if (isOrphan(subject)) return 0
	const isReused = subject.terminal.turn > 1
	const granted = isReused
		? policy.leaseMinutes.reusedHelper
		: policy.leaseMinutes.helper
	return granted * MINUTE_MS
}

function quietSinceMs(terminal: Terminal, memory: Memory): number {
	return Math.max(terminal.statusMs, memory.attachedMs[terminal.address] ?? 0)
}

function hasStepped(recipient: Terminal, subject: Terminal): boolean {
	const isStuck = STUCK_STATES.some(state => state === recipient.state)
	return !isStuck && recipient.statusMs >= subject.statusMs
}

// A helper that never worked has no result: reading its screen receives nothing.
export function hasRead(reader: Terminal, subject: Terminal): boolean {
	const readMs = Number(
		subject.labels[readLabel(reader.address)] ?? NEVER_SEEN,
	)
	return subject.turn > 0 && readMs >= subject.statusMs
}

function hasBeenSeen(terminal: Terminal, witness: Witness): boolean {
	const seenTurn = Number(
		terminal.labels[witness.policy.labels.seen] ?? NEVER_SEEN,
	)
	const lookedMs = witness.memory.attachedMs[terminal.address] ?? 0
	return seenTurn >= terminal.turn || lookedMs >= terminal.statusMs
}

function isReceived(subject: Subject, witness: Witness): boolean {
	const { terminal, owner } = subject
	if (owner !== null && hasStepped(owner, terminal)) return true
	if (owner !== null && hasRead(owner, terminal)) return true
	return subject.kind === 'helper'
		? owner === null
		: hasBeenSeen(terminal, witness)
}

// The lease starts when a sweep first witnesses the receipt: the clock never runs on a past the engine did not see.
export function receivedAtMs(
	subject: Subject,
	witness: Witness,
): number | null {
	const { terminal } = subject
	const remembered = witness.memory.received[terminal.address]
	if (remembered?.finishedMs === terminal.statusMs) return remembered.atMs
	if (!isReceived(subject, witness)) return null
	return witness.nowMs
}

export function leaseEndMs(subject: Subject, witness: Witness): number {
	const startMs = Math.max(
		quietSinceMs(subject.terminal, witness.memory),
		receivedAtMs(subject, witness) ?? 0,
	)
	return startMs + leaseMs(subject, witness.policy)
}
