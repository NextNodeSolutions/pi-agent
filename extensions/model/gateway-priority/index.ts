/**
 * gateway-priority - warns at session start when launchd would starve the
 * Magpie gateway of CPU, by running `bin/magpie-gateway-priority check`. The
 * script holds the rule and the repair (it acts only on the machine hosting
 * the gateway); this extension only schedules the check and shows its verdict.
 *
 * Single module: no state.
 */
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'

const run = promisify(execFile)
const TIMEOUT_MS = 5_000

function verdictText(error: unknown): string {
	if (
		error instanceof Error &&
		'stderr' in error &&
		typeof error.stderr === 'string' &&
		error.stderr.trim()
	)
		return error.stderr.trim()
	return `magpie-gateway-priority check failed: ${String(error)}`
}

async function warnWhenStarvable(ctx: ExtensionContext): Promise<void> {
	try {
		await run(
			join(getAgentDir(), 'bin', 'magpie-gateway-priority'),
			['check'],
			{ timeout: TIMEOUT_MS },
		)
	} catch (error) {
		ctx.ui.notify(verdictText(error), 'warning')
	}
}

export default function gatewayPriority(pi: ExtensionAPI): void {
	// Not awaited: pi runs session_start handlers in sequence and holds the first prompt until they all return.
	pi.on('session_start', (_event, ctx) => {
		if (ctx.hasUI) void warnWhenStarvable(ctx)
	})
}
