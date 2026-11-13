import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { checkoutOf, isInside } from './checkout.ts'
import { NOT_TRIED } from './memory.ts'
import { MINUTE_MS } from './policy.ts'

import type { Subject } from './classify.ts'
import type { Memory } from './memory.ts'
import type { Policy } from './policy.ts'
import type { Terminal } from './terminal.ts'

const execute = promisify(execFile)
const CLEANUP = fileURLToPath(
	new URL('../../worktree/scripts/cleanup', import.meta.url),
)
const CLEANUP_TIMEOUT_MS = 120_000
const OCCUPIED = 'a terminal is open in it'

// The first word of the cleanup script's line: it removed the folder, or left it to its pull request.
const SETTLED = ['removed', 'left'] as const

type Held = Memory['heldWorktrees']
type HeldEntry = Held[string]
type Outcome = (typeof SETTLED)[number] | 'skipped'
export type Removal = { folder: string; detail: string }
type Attempt = Removal & { outcome: Outcome }

// Without its owner there is nothing to compare against, so a worktree seen first while orphaned is never newly collected.
async function ownWorktree(owned: Subject): Promise<string | null> {
	if (owned.owner === null) return null
	const checkout = await checkoutOf(owned.terminal.cwd)
	if (!checkout?.isLinked) return null
	const ownerCheckout = await checkoutOf(owned.owner.cwd)
	if (checkout.root === ownerCheckout?.root) return null
	return checkout.root
}

export async function holdOwnedWorktrees(
	subjects: readonly Subject[],
	held: Held,
): Promise<Held> {
	const owned = subjects.filter(
		subject =>
			subject.ownerReference !== null &&
			(subject.kind === 'helper' || subject.kind === 'thread'),
	)
	const found = await Promise.all(
		owned.map(async subject => ({
			owner: subject.ownerReference ?? '',
			folder: await ownWorktree(subject),
		})),
	)
	const added = found.flatMap(({ owner, folder }): [string, HeldEntry][] =>
		folder === null || folder in held
			? []
			: [[folder, { owner, reason: OCCUPIED, triedMs: NOT_TRIED }]],
	)
	return { ...held, ...Object.fromEntries(added) }
}

async function tryRemoving(folder: string): Promise<Attempt> {
	if (!existsSync(folder))
		return { folder, detail: 'already gone', outcome: 'left' }
	try {
		const { stdout } = await execute(CLEANUP, ['--helper', folder], {
			timeout: CLEANUP_TIMEOUT_MS,
		})
		const [head = '', ...rest] = stdout.trim().split(': ')
		return {
			folder,
			detail: rest.join(': ') || head,
			outcome:
				SETTLED.find(word => head.startsWith(`${word} `)) ?? 'skipped',
		}
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error)
		return { folder, detail, outcome: 'skipped' }
	}
}

function isDue(entry: HeldEntry, policy: Policy, nowMs: number): boolean {
	return entry.triedMs + policy.worktreeRetryMinutes * MINUTE_MS <= nowMs
}

// One removal at a time: the cleanup script holds a lock per repository and skips while another run has it.
function removeInTurn(folders: readonly string[]): Promise<Attempt[]> {
	return folders.reduce<Promise<Attempt[]>>(
		async (earlier, folder) => [
			...(await earlier),
			await tryRemoving(folder),
		],
		Promise.resolve([]),
	)
}

function afterAttempt(
	entry: HeldEntry,
	attempt: Attempt | undefined,
	isFree: boolean,
	nowMs: number,
): HeldEntry | null {
	if (!isFree) return { ...entry, reason: OCCUPIED, triedMs: NOT_TRIED }
	if (!attempt) return entry
	if (attempt.outcome !== 'skipped') return null
	return { ...entry, reason: attempt.detail, triedMs: nowMs }
}

export async function releaseWorktrees(
	held: Held,
	terminals: readonly Terminal[],
	policy: Policy,
	nowMs: number,
): Promise<{ held: Held; removed: Removal[] }> {
	const isFree = (folder: string): boolean =>
		!terminals.some(terminal => isInside(terminal.cwd, folder))
	const due = Object.entries(held).filter(
		([folder, entry]) => isFree(folder) && isDue(entry, policy, nowMs),
	)
	const attempts = await removeInTurn(due.map(([folder]) => folder))
	const stillHeld = Object.entries(held).flatMap(
		([folder, entry]): [string, HeldEntry][] => {
			const attempt = attempts.find(tried => tried.folder === folder)
			const next = afterAttempt(entry, attempt, isFree(folder), nowMs)
			return next === null ? [] : [[folder, next]]
		},
	)
	return {
		held: Object.fromEntries(stillHeld),
		removed: attempts
			.filter(attempt => attempt.outcome === 'removed')
			.map(({ folder, detail }) => ({ folder, detail })),
	}
}
