import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

import {
	INTERRUPT,
	alertKind,
	describeAlert,
	isAlarming,
	isCommandRunning,
	isInterrupt,
	textLines,
} from './classify.mjs'
import {
	errorKind,
	readHistory,
	send,
	terminalFacts,
	waitForOutput,
} from './herdr.mjs'

const FIRST_ARGUMENT = 2
const [terminal, agent, dir] = process.argv.slice(FIRST_ARGUMENT)
if (!terminal || !agent || !dir)
	throw new Error(
		'usage: watch.mjs <watched-terminal> <agent-terminal> <state-dir>',
	)

const OUTPUT_LOG = `${dir}/output.log`
const ALERT_LOG = `${dir}/alerts.log`
const STATE_FILE = `${dir}/state.json`
const WAKE_REASONS = new Set(['output', 'timeout'])
const HISTORY_LINES = '400'
const IDLE_CHECK_SECONDS = '10'
const QUIET_SECONDS = '2'
const MAX_BURST_WAITS = 15
const MAX_STRANGE_WAKES = 5
const ANCHOR_CHARS = 400
const LABEL_CHARS = 80
const RESEND_AFTER_MS = 300_000

const stamp = () => new Date().toISOString()

let previous = ''
const readScreen = () => {
	const history = readHistory(terminal, HISTORY_LINES)
	if (history === null) return previous
	return history
		.split('\n')
		.filter(line => !line.startsWith('[hc]'))
		.join('\n')
		.trimEnd()
}

const observeTerminal = () => {
	const facts = terminalFacts(terminal)
	const isLive = facts.state === 'live'
	if (!isCommandRunning(facts)) return { isLive, command: null }
	const { foreground } = facts
	const label = [basename(foreground.argv[0]), ...foreground.argv.slice(1)]
		.join(' ')
		.slice(0, LABEL_CHARS)
	return { isLive, command: { pid: foreground.pid, label } }
}

let current = null
let alertCount = 0
let strangeWakes = 0
const sentAt = new Map()
const undelivered = []
const interrupted = new Set()

const deliverNotes = () => {
	while (undelivered.length > 0) {
		try {
			send(agent, undelivered[0])
		} catch (error) {
			return error
		}
		undelivered.shift()
	}
	return null
}
const notify = note => {
	undelivered.push(note)
	const refusal = deliverNotes()
	if (!refusal) return
	process.stdout.write(
		`${stamp()} ${agent} refused a note (${errorKind(refusal) ?? refusal.message}); it is retried at every wake\n`,
	)
}

const record = phase =>
	writeFileSync(
		STATE_FILE,
		JSON.stringify({
			terminal,
			agent,
			pid: process.pid,
			phase,
			alertCount,
			command: current?.label ?? null,
			updatedAt: stamp(),
		}),
	)
const logLines = lines =>
	appendFileSync(
		OUTPUT_LOG,
		lines.map(line => `[${stamp()}] ${line}\n`).join(''),
	)

const freshOutput = screen => {
	const anchor = previous.slice(-ANCHOR_CHARS)
	const position = anchor ? screen.lastIndexOf(anchor) : -1
	if (position >= 0) return screen.slice(position + anchor.length)
	const seenLines = new Set(previous.split('\n'))
	return screen
		.split('\n')
		.filter(line => !seenLines.has(line))
		.join('\n')
}
const collectFresh = () => {
	const screen = readScreen()
	const fresh = freshOutput(screen)
	previous = screen
	return textLines(fresh)
}
const collectBurst = () => {
	const burst = []
	for (let attempt = 0; attempt < MAX_BURST_WAITS; attempt += 1) {
		const waitOutcome = waitForOutput(terminal, QUIET_SECONDS)
		burst.push(...collectFresh())
		if (waitOutcome.reason !== 'output') break
	}
	return burst
}

const track = observation => {
	const next = observation.command
	if (next?.pid === current?.pid) return
	if (current) {
		logLines([`[terminal-watch] finished: ${current.label}`])
		interrupted.delete(current.pid)
	}
	if (next) logLines([`[terminal-watch] started: ${next.label}`])
	current = next ? { ...next, since: Date.now() } : null
	record('waiting')
}
// Herdr reports the foreground about a second late, so a ^C and the exit it causes can reach two inspections.
const noteInterrupt = (command, lines) => {
	if (command && lines.some(isInterrupt)) interrupted.add(command.pid)
}

const report = (kind, burst, command) => {
	const { block, headline, signature } = describeAlert(kind, burst, previous)
	const label = command?.label ?? 'no command'
	alertCount += 1
	appendFileSync(
		ALERT_LOG,
		`=== alert ${alertCount} · ${stamp()} · ${kind} · ${label} ===\n${block.join('\n')}\n\n`,
	)
	record('waiting')
	if (Date.now() - (sentAt.get(signature) ?? 0) < RESEND_AFTER_MS) return
	sentAt.set(signature, Date.now())
	notify(
		`[terminal-watch] ${kind} in ${terminal} (${label}): "${headline}". Block: alert ${alertCount} in ${ALERT_LOG}. Audit it; the watcher keeps running.`,
	)
}

const inspect = () => {
	const lines = collectFresh()
	const observation = observeTerminal()
	if (!observation.isLive) {
		logLines(lines)
		return false
	}
	if (!current) track(observation)
	const before = current
	if (!isAlarming(lines, before, observation)) {
		noteInterrupt(before, lines)
		logLines(lines)
		track(observation)
		return false
	}
	const burst = [...lines, ...collectBurst()]
	const after = observeTerminal()
	const heard = interrupted.has(before?.pid) ? [INTERRUPT, ...burst] : burst
	noteInterrupt(before, burst)
	logLines(burst)
	track(after)
	const kind = alertKind(heard, before, after, Date.now())
	if (kind) report(kind, heard, after.command ?? before)
	return true
}

const checkLifecycle = waitOutcome => {
	if (WAKE_REASONS.has(waitOutcome.reason)) {
		strangeWakes = 0
		return
	}
	strangeWakes += 1
	const { isLive } = observeTerminal()
	if (isLive && strangeWakes < MAX_STRANGE_WAKES) return
	const cause = isLive
		? `keeps waking the watcher with reason ${waitOutcome.reason}`
		: 'is gone'
	notify(
		`[terminal-watch] stopped: ${terminal} ${cause}. Monitoring is off until the watcher is restarted.`,
	)
	record('stopped')
	process.exit(0)
}

const watchForever = () => {
	for (;;) {
		deliverNotes()
		checkLifecycle(waitForOutput(terminal, IDLE_CHECK_SECONDS))
		// Output printed while an alert was being sent precedes the next wait, so inspect again before waiting.
		let hasInspected = inspect()
		while (hasInspected) hasInspected = inspect()
	}
}

try {
	mkdirSync(dir, { recursive: true })
	previous = readScreen()
	track(observeTerminal())
	record('waiting')
	process.stdout.write(
		`${stamp()} watching ${terminal} for ${agent}; output ${OUTPUT_LOG}, alerts ${ALERT_LOG}\n`,
	)
	watchForever()
} catch (error) {
	record('failed')
	process.stderr.write(
		`${stamp()} watcher failed: ${error instanceof Error ? error.message : String(error)}\n`,
	)
	process.exitCode = 1
}
