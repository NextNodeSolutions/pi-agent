import { checkoutOf } from './checkout.ts'
import { ownerReferenceOf } from './classify.ts'
import { endTerminal, readScreen, terminalAt } from './hc.ts'
import { appendEvent } from './journal.ts'
import { resumeRecipe } from './resume.ts'
import { titleOf } from './terminal.ts'
import { discardTrace, writeTrace } from './trace.ts'

import type { Verdict } from './decide.ts'
import type { ClosedEvent } from './journal.ts'
import type { Policy } from './policy.ts'
import type { Recipe } from './resume.ts'
import type { Terminal } from './terminal.ts'

export type Candidate = { verdict: Verdict; recipe: Recipe | null }

export type ClosingScene = {
	terminals: readonly Terminal[]
	verdicts: readonly Verdict[]
	policy: Policy
	nowMs: number
	recheck: (terminal: Terminal) => Promise<string | null>
}

export type Closing = { closed: ClosedEvent[]; refusal: string | null }

const refused = (refusal: string): Closing => ({ closed: [], refusal })

function endsWith(owner: string, terminals: readonly Terminal[]): Terminal[] {
	const children = terminals.filter(
		terminal => terminal.parent === owner && terminal.diesWithParent,
	)
	return children.flatMap(child =>
		[child].concat(endsWith(child.address, terminals)),
	)
}

function closedEvent(
	terminal: Terminal,
	detail: Pick<ClosedEvent, 'kind' | 'reason' | 'recipe' | 'trace'>,
	scene: ClosingScene,
): ClosedEvent {
	return {
		event: 'closed',
		atMs: scene.nowMs,
		address: terminal.address,
		name: terminal.name,
		title: titleOf(terminal),
		app: terminal.app,
		turn: terminal.turn,
		parent: terminal.parent,
		owner: ownerReferenceOf(terminal, scene.policy),
		labels: { ...terminal.labels },
		...detail,
	}
}

async function traceOf(
	candidate: Candidate,
	scene: ClosingScene,
): Promise<string | null> {
	const { verdict, recipe } = candidate
	if (verdict.kind !== 'thread' || recipe === null) return null
	const { terminal } = verdict
	const [screen, checkout] = await Promise.all([
		readScreen(terminal.address, scene.policy.traceScreenLines),
		checkoutOf(terminal.cwd),
	])
	return writeTrace({
		terminal,
		reason: verdict.reason,
		screen,
		recipe,
		branch: checkout?.branch ?? null,
		atMs: scene.nowMs,
	})
}

async function dependentEvent(
	dependent: Terminal,
	owner: Terminal,
	scene: ClosingScene,
): Promise<ClosedEvent> {
	const kind =
		scene.verdicts.find(
			verdict => verdict.terminal.address === dependent.address,
		)?.kind ?? 'unreported'
	return closedEvent(
		dependent,
		{
			kind,
			reason: `closed with ${titleOf(owner)}, which started it`,
			recipe: await resumeRecipe(dependent),
			trace: null,
		},
		scene,
	)
}

async function isUnchanged(terminal: Terminal): Promise<boolean> {
	const current = await terminalAt(terminal.address)
	return (
		current?.statusMs === terminal.statusMs &&
		current.state === terminal.state
	)
}

async function eventsOf(
	candidate: Candidate,
	trace: string | null,
	scene: ClosingScene,
): Promise<ClosedEvent[]> {
	const { verdict, recipe } = candidate
	const { terminal } = verdict
	const dependents = await Promise.all(
		endsWith(terminal.address, scene.terminals).map(dependent =>
			dependentEvent(dependent, terminal, scene),
		),
	)
	const detail = { kind: verdict.kind, reason: verdict.reason, recipe, trace }
	return [closedEvent(terminal, detail, scene), ...dependents]
}

// The trace and every recipe are taken before the kill, since Claude Code drops its session file when its process ends; a close that does not happen leaves no trace behind.
async function prepared(
	candidate: Candidate,
	scene: ClosingScene,
): Promise<Closing> {
	const trace = await traceOf(candidate, scene)
	try {
		const events = await eventsOf(candidate, trace, scene)
		const objection = await scene.recheck(candidate.verdict.terminal)
		if (objection === null) return { closed: events, refusal: null }
		discardTrace(trace)
		return refused(objection)
	} catch (error) {
		discardTrace(trace)
		throw error
	}
}

export async function closeTerminal(
	candidate: Candidate,
	scene: ClosingScene,
): Promise<Closing> {
	const { terminal } = candidate.verdict
	if (!(await isUnchanged(terminal)))
		return refused('it changed after the sweep looked at it')
	const preparation = await prepared(candidate, scene)
	if (preparation.refusal !== null) return preparation
	preparation.closed.forEach(appendEvent)
	return endRecorded(preparation.closed, terminal, scene)
}

async function stillRunning(
	events: readonly ClosedEvent[],
): Promise<ClosedEvent[]> {
	const running = await Promise.all(
		events.map(async event => (await terminalAt(event.address)) !== null),
	)
	return events.filter((_event, index) => running[index])
}

// The journal holds every resume recipe before the kill, so a crash after it loses none; a terminal a failed kill left running is reopened as itself, which keeps it the conversation's one process.
async function endRecorded(
	events: readonly ClosedEvent[],
	terminal: Terminal,
	scene: ClosingScene,
): Promise<Closing> {
	const owner = scene.terminals.find(
		other => other.address === terminal.parent,
	)
	try {
		await endTerminal(terminal.address, owner?.address ?? null)
		return { closed: [...events], refusal: null }
	} catch (error) {
		const survivors = await stillRunning(events)
		survivors.forEach(({ address }) =>
			appendEvent({
				event: 'reopened',
				atMs: Date.now(),
				address,
				as: address,
			}),
		)
		const detail = error instanceof Error ? error.message : String(error)
		return {
			closed: events.filter(event => !survivors.includes(event)),
			refusal: survivors.some(event => event.address === terminal.address)
				? `ending it failed: ${detail}`
				: null,
		}
	}
}
