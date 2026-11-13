import { GOAL_LABEL, WAITING_LABEL } from '#lib/ui/herdr-labels.ts'

import { isRemote, toSubject } from './classify.ts'
import {
	hasRead,
	isOrphan,
	leaseEndMs,
	leaseMs,
	receivedAtMs,
} from './lease.ts'
import { MINUTE_MS } from './policy.ts'
import { titleOf } from './terminal.ts'

import type { Subject } from './classify.ts'
import type { Memory } from './memory.ts'
import type { Policy } from './policy.ts'
import type { Terminal, TerminalClass } from './terminal.ts'

export type World = {
	terminals: readonly Terminal[]
	attached: ReadonlySet<string>
	memory: Memory
	policy: Policy
	nowMs: number
}

export type Verdict = {
	terminal: Terminal
	kind: TerminalClass
	action: 'close' | 'keep'
	rule: string
	reason: string
	closesAtMs: number | null
	receivedAtMs: number | null
}

type Scene = World & { subjects: readonly Subject[] }
type Objection = { rule: string; reason: string; untilMs?: number }
type Guard = (subject: Subject, scene: Scene) => Objection | null

const minutes = (durationMs: number): number =>
	Math.ceil(durationMs / MINUTE_MS)

const isResting = (terminal: Terminal, policy: Policy): boolean =>
	terminal.state !== null && policy.restingStates.includes(terminal.state)

const pendingWork = (terminal: Terminal): string =>
	terminal.labels[WAITING_LABEL] ?? ''

const openItems = (terminal: Terminal): string =>
	terminal.labels[GOAL_LABEL] ?? ''

const isKept = (terminal: Terminal, policy: Policy): boolean =>
	Boolean(terminal.labels[policy.labels.keep])

// Closing an owner ends the children that die with it, and theirs in turn, so a descendant that still matters holds every ancestor open.
function needsItsOwner(dependent: Subject, scene: Scene): boolean {
	const { terminal } = dependent
	if (terminal.state === null) return terminal.diesWithParent
	const isBusy =
		!isResting(terminal, scene.policy) ||
		pendingWork(terminal) !== '' ||
		openItems(terminal) !== ''
	if (isBusy || !terminal.diesWithParent) return isBusy
	return (
		isKept(terminal, scene.policy) ||
		scene.attached.has(terminal.address) ||
		leaseEndMs(dependent, scene) > scene.nowMs ||
		dependentsNeeding(terminal, scene).length > 0
	)
}

function dependentsNeeding(owner: Terminal, scene: Scene): Subject[] {
	return scene.subjects.filter(
		candidate =>
			candidate.owner?.address === owner.address &&
			needsItsOwner(candidate, scene),
	)
}

const untouchable: Guard = ({ terminal, kind }) => {
	if (kind === 'principal')
		return { rule: 'principal', reason: 'Principal never closes' }
	if (kind === 'auxiliary')
		return {
			rule: 'auxiliary',
			reason: 'the Command Center ends it with its thread',
		}
	if (isRemote(terminal))
		return { rule: 'unreported', reason: 'it runs on another machine' }
	if (kind !== 'unreported') return null
	return { rule: 'unreported', reason: 'it reports no agent status' }
}

const kept: Guard = ({ terminal }, { policy }) => {
	if (!isKept(terminal, policy)) return null
	return { rule: 'kept', reason: 'it is kept open on purpose' }
}

const busy: Guard = ({ terminal }, { policy }) => {
	if (isResting(terminal, policy)) return null
	return { rule: 'busy', reason: `it is ${terminal.state}` }
}

const waking: Guard = ({ terminal }) => {
	const pending = pendingWork(terminal)
	if (!pending) return null
	return { rule: 'waiting', reason: `it waits on ${pending}` }
}

// Nobody is left to answer an orphan helper, so its open items hold nothing.
const unfinished: Guard = subject => {
	const open = openItems(subject.terminal)
	if (!open || isOrphan(subject)) return null
	return { rule: 'unfinished', reason: `its task is not finished (${open})` }
}

const needed: Guard = ({ terminal }, scene) => {
	const dependents = dependentsNeeding(terminal, scene)
	if (!dependents.length) return null
	const names = dependents.map(dependent => titleOf(dependent.terminal))
	return {
		rule: 'needed',
		reason: `${names.join(', ')}, which it started, still needs it`,
	}
}

const watched: Guard = ({ terminal }, { attached }) => {
	if (!attached.has(terminal.address)) return null
	return { rule: 'watched', reason: 'the person is on it' }
}

const undelivered: Guard = (subject, scene) => {
	if (receivedAtMs(subject, scene) !== null) return null
	const { owner, kind } = subject
	const unseen = 'the person has not looked at its last result'
	if (owner === null) return { rule: 'undelivered', reason: unseen }
	const waiting = `${titleOf(owner)} has neither read it nor started or ended a turn since it finished (${owner.state})`
	return {
		rule: 'undelivered',
		reason: kind === 'thread' ? `${waiting}, and ${unseen}` : waiting,
	}
}

// An owner in the middle of a turn can still read its helper's screen, so only a recorded read lets the helper go before that turn ends.
const awaited: Guard = ({ kind, owner, terminal }, { policy }) => {
	if (kind !== 'helper' || !owner?.state || isResting(owner, policy))
		return null
	if (hasRead(owner, terminal)) return null
	return {
		rule: 'owner-busy',
		reason: `${titleOf(owner)}, which started it, is ${owner.state} and no read of its result is recorded`,
	}
}

const leased: Guard = (subject, scene) => {
	const untilMs = leaseEndMs(subject, scene)
	if (untilMs <= scene.nowMs) return null
	const left = minutes(untilMs - scene.nowMs)
	return { rule: 'lease', reason: `its lease runs ${left} more min`, untilMs }
}

const GUARDS: readonly Guard[] = [
	untouchable,
	kept,
	busy,
	waking,
	unfinished,
	needed,
	watched,
	undelivered,
	awaited,
	leased,
]

function closing(subject: Subject, scene: Scene): Objection {
	if (isOrphan(subject))
		return {
			rule: 'orphan',
			reason: `its owner ${subject.ownerReference} is gone`,
		}
	const quiet = minutes(scene.nowMs - subject.terminal.statusMs)
	const granted = minutes(leaseMs(subject, scene.policy))
	return {
		rule: 'lease-ended',
		reason: `its ${granted} min lease ended: it finished ${quiet} min ago and its result was received`,
	}
}

function firstObjection(subject: Subject, scene: Scene): Objection | null {
	for (const guard of GUARDS) {
		const objection = guard(subject, scene)
		if (objection !== null) return objection
	}
	return null
}

function judge(subject: Subject, scene: Scene): Verdict {
	const objection = firstObjection(subject, scene)
	const outcome = objection ?? closing(subject, scene)
	const isResult = subject.kind === 'helper' || subject.kind === 'thread'
	return {
		terminal: subject.terminal,
		kind: subject.kind,
		action: objection ? 'keep' : 'close',
		rule: outcome.rule,
		reason: outcome.reason,
		closesAtMs: objection ? (objection.untilMs ?? null) : scene.nowMs,
		receivedAtMs:
			isResult && isResting(subject.terminal, scene.policy)
				? receivedAtMs(subject, scene)
				: null,
	}
}

export function decide(world: World): Verdict[] {
	const subjects = world.terminals.map(terminal =>
		toSubject(terminal, world.terminals, world.policy),
	)
	const scene: Scene = { ...world, subjects }
	return subjects.map(subject => judge(subject, scene))
}
