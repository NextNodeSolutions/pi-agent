import { join } from 'node:path'

import { Type } from 'typebox'

import { parseJson } from './schema.ts'
import { readOrNull, stateDirectory, writeAtomically } from './storage.ts'

import type { Static } from 'typebox'

const MemorySchema = Type.Object({
	attachedMs: Type.Record(Type.String(), Type.Number()),
	received: Type.Record(
		Type.String(),
		Type.Object({ finishedMs: Type.Number(), atMs: Type.Number() }),
	),
	marks: Type.Record(
		Type.String(),
		Type.Object({ screen: Type.String(), atMs: Type.Number() }),
	),
	heldWorktrees: Type.Record(
		Type.String(),
		Type.Object({
			owner: Type.String(),
			reason: Type.String(),
			triedMs: Type.Number(),
		}),
	),
})

export type Memory = Static<typeof MemorySchema>

const EMPTY: Memory = {
	attachedMs: {},
	received: {},
	marks: {},
	heldWorktrees: {},
}
export const NOT_TRIED = 0
const MEMORY_FILE = 'memory.json'

export function readMemory(): Memory {
	const text = readOrNull(join(stateDirectory(), MEMORY_FILE))
	if (text === null) return EMPTY
	return parseJson(MemorySchema, text)
}

export function writeMemory(memory: Memory): void {
	writeAtomically(
		join(stateDirectory(), MEMORY_FILE),
		`${JSON.stringify(memory, null, '\t')}\n`,
	)
}

function only<Entry>(
	entries: Record<string, Entry>,
	addresses: ReadonlySet<string>,
): Record<string, Entry> {
	return Object.fromEntries(
		Object.entries(entries).filter(([address]) => addresses.has(address)),
	)
}

export const triedWorktrees = (
	held: Memory['heldWorktrees'],
): [string, Memory['heldWorktrees'][string]][] =>
	Object.entries(held).filter(([, entry]) => entry.triedMs !== NOT_TRIED)

// Held worktrees outlive the terminal that worked in them: they are kept until their removal succeeds.
export function forgetGone(memory: Memory, live: ReadonlySet<string>): Memory {
	return {
		attachedMs: only(memory.attachedMs, live),
		received: only(memory.received, live),
		marks: only(memory.marks, live),
		heldWorktrees: memory.heldWorktrees,
	}
}
