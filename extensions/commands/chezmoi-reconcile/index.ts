/**
 * /chezmoi-reconcile - drops from the chezmoi source every managed target the
 * live config no longer has, by running `bin/chezmoi-reconcile`. The script
 * holds the whole rule (it acts on the Mac Studio only, where live is truth);
 * this extension only schedules it: at session start, at session shutdown and
 * on demand through the command, so a deletion made in a session never comes
 * back through a later `chezmoi apply` or the MacBook's pull.
 *
 * Single module: no state, no UI beyond the notification of what was forgotten.
 */
import { execFile, spawn } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'

const run = promisify(execFile)
const TIMEOUT_MS = 15_000

function scriptPath(): string {
	return join(getAgentDir(), 'bin', 'chezmoi-reconcile')
}

async function reconcile(): Promise<string> {
	const { stdout } = await run(scriptPath(), [], { timeout: TIMEOUT_MS })
	return stdout.trim()
}

async function reconcileQuietly(ctx: ExtensionContext): Promise<void> {
	try {
		const report = await reconcile()
		if (report && ctx.hasUI) ctx.ui.notify(report, 'info')
	} catch {
		return
	}
}

export default function chezmoiReconcile(pi: ExtensionAPI): void {
	// Not awaited: pi runs session_start handlers in sequence and holds the first prompt until they all return.
	pi.on('session_start', (_event, ctx) => {
		void reconcileQuietly(ctx)
	})
	pi.on('session_shutdown', () => {
		spawn(scriptPath(), [], { detached: true, stdio: 'ignore' }).unref()
	})
	pi.registerCommand('chezmoi-reconcile', {
		description:
			'Drop from the chezmoi source the managed files deleted live (Mac Studio only)',
		handler: async (_args, ctx) => {
			try {
				const report = await reconcile()
				ctx.ui.notify(
					report || 'chezmoi source already matches the live config',
					'info',
				)
			} catch (error) {
				ctx.ui.notify(
					`chezmoi-reconcile failed: ${String(error)}`,
					'error',
				)
			}
		},
	})
}
