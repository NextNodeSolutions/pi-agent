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

export type Closings = {
	closed: ClosedEvent[]
	refusals: Record<string, string>
}

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

async function closeTerminal(
	candidate: Candidate,
	scene: ClosingScene,
): Promise<Closing> {
	const { terminal } = candidate.verdict
	if (!(await isUnchanged(terminal)))
		return refused('it changed after the sweep looked at it')
	const preparation = await prepared(candidate, scene)
	if (preparation.refusal !== null) return preparation
	const owner = scene.terminals.find(
		other => other.address === terminal.parent,
	)
	await endTerminal(terminal.address, owner?.address ?? null)
	preparation.closed.forEach(appendEvent)
	return preparation
}

async function closeOne(
	candidate: Candidate,
	scene: ClosingScene,
): Promise<Closing> {
	try {
		return await closeTerminal(candidate, scene)
	} catch (error) {
		const refusal = error instanceof Error ? error.message : String(error)
		return { closed: [], refusal }
	}
}

// One failed close must not stop the others, so each candidate's failure becomes its own refusal; a candidate an earlier close already ended is skipped.
export function closeEach(
	confirmed: readonly Candidate[],
	scene: ClosingScene,
): Promise<Closings> {
	return confirmed.reduce<Promise<Closings>>(
		async (earlier, candidate) => {
			const done = await earlier
			const { address } = candidate.verdict.terminal
			if (done.closed.some(event => event.address === address))
				return done
			const { closed, refusal } = await closeOne(candidate, scene)
			return {
				closed: [...done.closed, ...closed],
				refusals:
					refusal === null
						? done.refusals
						: { ...done.refusals, [address]: refusal },
			}
		},
		Promise.resolve({ closed: [], refusals: {} }),
	)
}

export function withRefusals(
	verdicts: readonly Verdict[],
	refusals: Closings['refusals'],
): Verdict[] {
	return verdicts.map(verdict => {
		const refusal = refusals[verdict.terminal.address]
		if (refusal === undefined) return verdict
		return {
			...verdict,
			action: 'keep',
			rule: 'refused',
			reason: `the last check before closing objected: ${refusal}`,
			closesAtMs: null,
		}
	})
}
