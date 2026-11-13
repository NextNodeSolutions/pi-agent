import { attachedTerminals } from './attention.ts'
import { toSubject } from './classify.ts'
import { closeTerminal } from './closing.ts'
import { decide } from './decide.ts'
import { liveTerminals, screenFingerprint } from './hc.ts'
import { appendEvent } from './journal.ts'
import { forgetGone, readMemory, writeMemory } from './memory.ts'
import { writeClosedPage } from './page.ts'
import { loadPolicy } from './policy.ts'
import { mayClose } from './recheck.ts'
import { resumeRecipe } from './resume.ts'
import { holdOwnedWorktrees, releaseWorktrees } from './worktrees.ts'

import type { WindowSource } from './attention.ts'
import type { Candidate } from './closing.ts'
import type { Verdict, World } from './decide.ts'
import type { ClosedEvent } from './journal.ts'
import type { Memory } from './memory.ts'
import type { Terminal } from './terminal.ts'
import type { Removal } from './worktrees.ts'

const SECOND_MS = 1000

export type SweepOptions = {
	mode: 'dry-run' | 'apply'
	attached: readonly string[]
	window: WindowSource
	policyFile: string | null
}

export type SweepReport = {
	mode: SweepOptions['mode']
	verdicts: Verdict[]
	closed: ClosedEvent[]
	removedWorktrees: Removal[]
	heldWorktrees: Memory['heldWorktrees']
}

type Marks = Memory['marks']

function witnessed(
	memory: Memory,
	attached: ReadonlySet<string>,
	live: ReadonlySet<string>,
	nowMs: number,
): Memory {
	const lookedAt = [...attached].filter(address => live.has(address))
	const living = forgetGone(memory, live)
	return {
		...living,
		attachedMs: {
			...living.attachedMs,
			...Object.fromEntries(lookedAt.map(address => [address, nowMs])),
		},
	}
}

async function settle(verdict: Verdict): Promise<Candidate> {
	if (verdict.action === 'keep') return { verdict, recipe: null }
	const recipe = await resumeRecipe(verdict.terminal)
	if (recipe !== null || verdict.kind !== 'thread') return { verdict, recipe }
	return {
		recipe,
		verdict: {
			...verdict,
			action: 'keep',
			rule: 'unresumable',
			reason: 'its program left nothing to resume its conversation from',
			closesAtMs: null,
		},
	}
}

// A close needs two sweeps that agree: a screen that changed in between means someone or something is still using it.
async function confirm(
	candidate: Candidate,
	world: World,
): Promise<{ candidate: Candidate; mark: Marks[string] | null }> {
	const { verdict } = candidate
	if (verdict.action === 'keep') return { candidate, mark: null }
	const { address } = verdict.terminal
	const screen = await screenFingerprint(address)
	const earlier = world.memory.marks[address]
	const markedMs = earlier?.screen === screen ? earlier.atMs : world.nowMs
	const confirmedAtMs = markedMs + world.policy.confirmSeconds * SECOND_MS
	if (confirmedAtMs <= world.nowMs && earlier?.screen === screen)
		return { candidate, mark: null }
	const waiting: Verdict = {
		...verdict,
		action: 'keep',
		rule: 'confirming',
		reason: `${verdict.reason}; it closes at the next sweep if its screen stays as it is`,
		closesAtMs: confirmedAtMs,
	}
	return {
		candidate: { ...candidate, verdict: waiting },
		mark: { screen, atMs: markedMs },
	}
}

function receipts(verdicts: readonly Verdict[]): Memory['received'] {
	return Object.fromEntries(
		verdicts.flatMap(({ terminal, receivedAtMs }) =>
			receivedAtMs === null
				? []
				: [
						[
							terminal.address,
							{
								finishedMs: terminal.statusMs,
								atMs: receivedAtMs,
							},
						],
					],
		),
	)
}

async function closeConfirmed(
	candidates: readonly Candidate[],
	world: World,
	options: SweepOptions,
): Promise<ClosedEvent[]> {
	const scene = {
		terminals: world.terminals,
		verdicts: candidates.map(candidate => candidate.verdict),
		policy: world.policy,
		nowMs: world.nowMs,
		mayClose: (terminal: Terminal) => mayClose(terminal, world, options),
	}
	const confirmed = candidates.filter(
		candidate => candidate.verdict.action === 'close',
	)
	return confirmed.reduce<Promise<ClosedEvent[]>>(
		async (earlier, candidate) => {
			const closed = await earlier
			const isGone = closed.some(
				event => event.address === candidate.verdict.terminal.address,
			)
			return isGone
				? closed
				: [...closed, ...(await closeTerminal(candidate, scene))]
		},
		Promise.resolve([]),
	)
}

async function collectWorktrees(
	world: World,
	closed: readonly ClosedEvent[],
): Promise<{ held: Memory['heldWorktrees']; removed: Removal[] }> {
	const subjects = world.terminals.map(terminal =>
		toSubject(terminal, world.terminals, world.policy),
	)
	const held = await holdOwnedWorktrees(subjects, world.memory.heldWorktrees)
	const survivors = world.terminals.filter(
		terminal => !closed.some(event => event.address === terminal.address),
	)
	const released = await releaseWorktrees(
		held,
		survivors,
		world.policy,
		world.nowMs,
	)
	released.removed.forEach(({ folder, detail }) =>
		appendEvent({
			event: 'worktree-removed',
			atMs: world.nowMs,
			folder,
			detail,
		}),
	)
	return released
}

async function apply(
	settled: readonly Candidate[],
	world: World,
	options: SweepOptions,
): Promise<SweepReport> {
	const confirmations = await Promise.all(
		settled.map(candidate => confirm(candidate, world)),
	)
	const candidates = confirmations.map(({ candidate }) => candidate)
	const marks = Object.fromEntries(
		confirmations.flatMap(({ candidate, mark }) =>
			mark === null ? [] : [[candidate.verdict.terminal.address, mark]],
		),
	)
	const closed = await closeConfirmed(candidates, world, options)
	const worktrees = await collectWorktrees(world, closed)
	const verdicts = candidates.map(candidate => candidate.verdict)
	writeMemory({
		attachedMs: world.memory.attachedMs,
		received: receipts(verdicts),
		marks,
		heldWorktrees: worktrees.held,
	})
	writeClosedPage()
	return {
		mode: 'apply',
		verdicts,
		closed,
		removedWorktrees: worktrees.removed,
		heldWorktrees: worktrees.held,
	}
}

export async function sweep(options: SweepOptions): Promise<SweepReport> {
	const policy = loadPolicy(options.policyFile)
	const terminals = await liveTerminals()
	const attached = await attachedTerminals(options.attached, options.window)
	const nowMs = Date.now()
	const live = new Set(terminals.map(terminal => terminal.address))
	const memory = witnessed(readMemory(), attached, live, nowMs)
	const world: World = { terminals, attached, memory, policy, nowMs }
	const settled = await Promise.all(
		decide(world).map(verdict => settle(verdict)),
	)
	if (options.mode === 'apply') return apply(settled, world, options)
	return {
		mode: 'dry-run',
		verdicts: settled.map(candidate => candidate.verdict),
		closed: [],
		removedWorktrees: [],
		heldWorktrees: memory.heldWorktrees,
	}
}
