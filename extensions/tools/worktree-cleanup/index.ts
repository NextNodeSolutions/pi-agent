/** Retry the worktree skill's guarded cleanup after a PR ends and once the agent settles. */
import { runtimeFor } from '#lib/runtime/runtime.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'

const PR_END =
	/\bgh(?:\s+(?:--repo|-R|--hostname)\s+\S+)*\s+pr\s+(?:merge|close)(?=\s|$)/
const CLEANUP = '"$HOME/.pi/agent/skills/worktree/scripts/cleanup"'

function quote(repository: string): string {
	return `'${repository.replaceAll("'", "'\\''")}'`
}

async function sweep(context: ExtensionContext): Promise<string> {
	const runtime = runtimeFor(context.cwd)
	const repository = runtime.toTarget(context.cwd)
	const commandOutput = await runtime.run(
		`${CLEANUP} ${quote(repository)}`,
		context.cwd,
	)
	const report = [commandOutput.stdout.trim(), commandOutput.stderr.trim()]
		.filter(Boolean)
		.join('\n')
	if (commandOutput.exitCode !== 0)
		throw new Error(report || `cleanup exited ${commandOutput.exitCode}`)
	return report
}

async function retry(context: ExtensionContext): Promise<void> {
	try {
		context.ui.notify(`Worktree cleanup:\n${await sweep(context)}`, 'info')
	} catch (error: unknown) {
		context.ui.notify(
			`Worktree cleanup failed: ${String(error)}`,
			'warning',
		)
	}
}

export default function worktreeCleanup(pi: ExtensionAPI): void {
	let shouldRetry = false
	pi.on('tool_result', async (event, context) => {
		if (event.toolName !== 'bash') return undefined
		const { command } = event.input
		if (typeof command !== 'string' || !PR_END.test(command))
			return undefined
		shouldRetry = true
		try {
			const report = await sweep(context)
			return {
				content: [
					...event.content,
					{ type: 'text', text: `Worktree cleanup:\n${report}` },
				],
			}
		} catch (error: unknown) {
			context.ui.notify(
				`Worktree cleanup failed: ${String(error)}`,
				'warning',
			)
			return undefined
		}
	})
	pi.on('agent_settled', (_event, context) => {
		if (!shouldRetry) return
		shouldRetry = false
		void retry(context)
	})
}
