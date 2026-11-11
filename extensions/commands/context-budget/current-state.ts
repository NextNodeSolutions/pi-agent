/** Small, observed evidence supplement from the full edited projection, not just its old prefix. */
import { commandEvidence, evidenceText } from '#lib/command-evidence/schema.ts'
import { runtimeFor } from '#lib/runtime/runtime.ts'

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

const MAX_RECENT_RESULTS = 8
const MAX_RESULT_CHARS = 1200
const MAX_STATUS_LINES = 60
const GIT_TIMEOUT_MS = 5000
const GIT_SNAPSHOT = `git rev-parse --abbrev-ref HEAD && git rev-parse --short HEAD && git status --short | head -n ${MAX_STATUS_LINES}`

/** Branch, HEAD and changed paths of the cwd, so the next window starts from known tree state instead of re-running git. */
async function gitSnapshot(cwd: string): Promise<string> {
	const chunks: string[] = []
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), GIT_TIMEOUT_MS)
	try {
		const { exitCode } = await runtimeFor(cwd).exec(GIT_SNAPSHOT, cwd, {
			signal: controller.signal,
			onData: (chunk: Buffer | string) => chunks.push(chunk.toString()),
		})
		if (exitCode !== 0) return ''
	} catch {
		return ''
	} finally {
		clearTimeout(timer)
	}
	const [branch, head, ...status] = chunks.join('').trim().split('\n')
	if (!branch || !head) return ''
	const changed = status.filter(Boolean)
	return [
		`Git state observed at checkpoint time in ${cwd}: branch ${branch}, HEAD ${head}, ${changed.length} changed path(s)${changed.length >= MAX_STATUS_LINES ? ' (list capped)' : ''}.`,
		...changed,
	].join('\n')
}

export async function currentCheckpointState(
	ctx: ExtensionContext,
): Promise<string> {
	const { messages } = ctx.sessionManager.buildSessionProjection()
	const observed = messages
		.filter(
			message =>
				message.role === 'toolResult' && message.toolName === 'bash',
		)
		.slice(-MAX_RECENT_RESULTS)
	const results = observed.map(message => {
		if (message.role !== 'toolResult') return ''
		const text = message.content
			.filter(part => part.type === 'text')
			.map(part => part.text)
			.join('\n')
		return `Call ${message.toolCallId}; tool error: ${message.isError}; reported output tail (not an inferred suite status):\n${text.slice(-MAX_RESULT_CHARS)}`
	})
	const saved = commandEvidence(ctx.sessionManager.getBranch())
		.slice(-MAX_RECENT_RESULTS)
		.map(record =>
			evidenceText({
				...record,
				command:
					record.command.length > MAX_RESULT_CHARS
						? `${record.command.slice(0, MAX_RESULT_CHARS)} [command truncated; full command in receipt]`
						: record.command,
			}),
		)
	return [
		'This bounded supplement uses the full projected session and current branch evidence. Absence here is NOT proof a command never ran. Later retained messages take precedence over this snapshot. Tool success alone does not establish the exit status of an upstream pipeline.',
		await gitSnapshot(ctx.cwd),
		...saved,
		...results,
	]
		.filter(Boolean)
		.join('\n\n')
}
