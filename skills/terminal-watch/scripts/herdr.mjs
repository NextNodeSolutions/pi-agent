import { execFileSync } from 'node:child_process'

const MAX_READ_BYTES = 8_388_608
const MISSING = 'not_found'

const hc = args =>
	execFileSync('herdr-core', args, {
		encoding: 'utf8',
		maxBuffer: MAX_READ_BYTES,
	})

export const errorKind = error => {
	const reply = String(error?.stderr ?? '').trim()
	if (!reply.startsWith('{')) return undefined
	return JSON.parse(reply).error?.kind
}

const unlessMissing = ask => {
	try {
		return ask()
	} catch (error) {
		if (errorKind(error) === MISSING) return null
		throw error
	}
}

export const readHistory = (terminal, lines) =>
	unlessMissing(() => hc(['read', terminal, '--lines', lines]))

export const waitForOutput = (terminal, seconds) =>
	unlessMissing(() =>
		JSON.parse(
			hc([
				'wait',
				terminal,
				'--output',
				' ',
				'--timeout',
				seconds,
				'--json',
			]),
		),
	) ?? { reason: MISSING }

export const terminalFacts = terminal =>
	unlessMissing(() => JSON.parse(hc(['get', terminal, '--json']))) ?? {
		state: MISSING,
	}

export const send = (terminal, text) => hc(['send', terminal, text])
