import { askChoice, isJevConfigured } from '#lib/jev/client.ts'

const SKIP_PROBABILITY = 0.8
const TRIAGE_TIMEOUT_MS = 8_000
const PROBABILITY_DIGITS = 2

const TRIAGE_QUESTION = {
	instructions:
		'A watcher flagged warnings or errors in the terminal where a developer runs `command`; `alertKind` is its rule-based label and `output` is the terminal output leading to the flag, oldest line first. Decide whether a coding agent must spend an audit on it. Judge the state at the END of `output`: what the developer finds in the terminal now. An error that the output itself explains and resolves is not worth an audit; an error that is still there, or whose cause is unclear, is.',
	criteria: {
		skip: 'Every error in `output` is explained and resolved inside it. Either the developer pressed Ctrl+C (a line starting with `^C`) and the errors are its shutdown fallout (exit status 130, SIGINT, `ELIFECYCLE Command failed` right after it), possibly followed by the developer starting the command again; or a restart or rebuild failed transiently and a later success line (`server restarted`, `ready in`, `compiled`, `hot updated`) follows the last error, with no error after it.',
		audit: 'Anything else: an error or warning after the last success line, a restart that failed with no later recovery (for example `server restart failed` or a port already in use among the last lines), a crash or stack trace through project files, a command that exited after errors without any Ctrl+C, a long-running command that exited on its own, or any doubt.',
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
