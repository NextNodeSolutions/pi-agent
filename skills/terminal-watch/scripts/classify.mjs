const ALERT =
	/\b(?:errors?|warn(?:ings?)?|exception|unhandled|uncaught|failed|fatal|panic|deprecated|EADDRINUSE|ECONNREFUSED|ELIFECYCLE)\b|\bERR_[A-Z_]+|does not exist|is not defined|is not a function|cannot find/i
const PROMPT = /^❯(?:\s|$)|\son\s+\S.*\svia\s/u
const LONG_RUN_MS = 60_000
const SHELLS = new Set(['zsh', '-zsh', 'bash', 'sh', 'fish', 'nu'])
export const INTERRUPT = '^C'

export const isAlertLine = line => ALERT.test(line)
export const isInterrupt = line => line.startsWith(INTERRUPT)
const isPrompt = line => PROMPT.test(line)

export const textLines = text =>
	text
		.split('\n')
		.map(line => line.trimEnd())
		.filter(Boolean)

const withoutShutdowns = lines => {
	const kept = []
	let isShuttingDown = false
	for (const line of lines) {
		if (isInterrupt(line)) isShuttingDown = true
		if (!isShuttingDown) kept.push(line)
		if (isPrompt(line)) isShuttingDown = false
	}
	return kept
}
export const signalLines = lines =>
	withoutShutdowns(lines).filter(line => !isPrompt(line))

const isInteractiveShell = foreground =>
	SHELLS.has(foreground.name) &&
	foreground.argv
		.slice(1)
		.filter(Boolean)
		.every(argument => argument.startsWith('-'))
export const isCommandRunning = facts =>
	facts.state === 'live' &&
	Boolean(facts.foreground?.pid) &&
	facts.foreground.pid !== facts.pid &&
	!isInteractiveShell(facts.foreground)

const hasFinished = (before, observation) =>
	before !== null && observation.command?.pid !== before.pid

export const isAlarming = (lines, before, observation) =>
	hasFinished(before, observation) ||
	((before !== null || observation.command !== null) &&
		lines.some(isAlertLine))

export const alertKind = (burst, before, after, now) => {
	const isFinished = hasFinished(before, after)
	if (signalLines(burst).some(isAlertLine)) {
		return isFinished && after.command === null
			? 'command failed'
			: 'warning/error'
	}
	if (!isFinished || burst.some(isInterrupt)) return null
	if (now - before.since < LONG_RUN_MS) return null
	return 'long-running command exited'
}
