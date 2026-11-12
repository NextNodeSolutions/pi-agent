import { askChoice, isJevConfigured } from '#lib/jev/client.ts'

const SKIP_PROBABILITY = 0.8
const TRIAGE_TIMEOUT_MS = 8_000
const PROBABILITY_DIGITS = 2

const TRIAGE_QUESTION = {
	instructions:
		'A watcher flagged warnings or errors in the terminal where a developer runs `command`; `alertKind` is its rule-based label and `output` is the terminal output leading to the flag, oldest line first. Decide whether a coding agent must spend an audit on it. Only two situations explain themselves: the developer pressing Ctrl+C, and one restart whose only error is the hand-over between the old and the new server. A later success line does not excuse any other error: errors raised while a server restarts can be real faults even when it comes back.',
	criteria: {
		skip: 'Either the developer pressed Ctrl+C (a line starting with `^C`) and every error is its shutdown fallout (exit status 130, SIGINT, `ELIFECYCLE Command failed` right after it), possibly followed by the developer starting the command again; or one restart failed once for a hand-over reason only (the old server still holding the port, a file read while it was being saved) and the next restart reports success (`server restarted`, `ready in`), with no other error anywhere in `output`.',
		audit: 'Anything else, even when a success line follows: a restart storm (overlapping restarts, `server restart failed` more than once), an initialization race (for example `already initialized`), an `Internal server error` or a failed request, a stack trace, an error after the last success line, a restart that never recovered, a crash, a command that exited after errors without any Ctrl+C, a long-running command that exited on its own, or any doubt.',
	},
}

const oneLine = text => text.replace(/\s+/g, ' ').trim()

export const triageAlert = async ({ kind, label, block }) => {
	if (!isJevConfigured())
		return {
			shouldWake: true,
			verdict: 'triage: sent, TYPESAFE_API_KEY is not set',
		}
	try {
		const decision = await askChoice(
			{ command: label, alertKind: kind, output: block.join('\n') },
			TRIAGE_QUESTION,
			{ timeoutMs: TRIAGE_TIMEOUT_MS },
		)
		const skipProbability = decision.probabilities.skip ?? 0
		const shouldWake = skipProbability < SKIP_PROBABILITY
		return {
			shouldWake,
			verdict: `triage: ${shouldWake ? 'sent' : 'skipped'}, p(skip) ${skipProbability.toFixed(PROBABILITY_DIGITS)}, ${decision.inputTokens} tokens`,
		}
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		return { shouldWake: true, verdict: `triage: sent, ${oneLine(reason)}` }
	}
}
