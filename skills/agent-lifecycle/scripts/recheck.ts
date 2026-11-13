import { attachedTerminals } from './attention.ts'
import { decide } from './decide.ts'
import { liveTerminals, screenFingerprint } from './hc.ts'

import type { World } from './decide.ts'
import type { SweepOptions } from './sweep.ts'
import type { Terminal } from './terminal.ts'

/** Why the terminal may no longer close, judged on fresh state just before the kill, or null when it still may. */
export async function recheck(
	terminal: Terminal,
	world: World,
	options: SweepOptions,
): Promise<string | null> {
	const terminals = await liveTerminals()
	const current = terminals.find(other => other.address === terminal.address)
	if (JSON.stringify(current) !== JSON.stringify(terminal))
		return 'it changed after the sweep looked at it'
	const attached = await attachedTerminals(options.attached, options.window)
	const verdict = decide({
		...world,
		terminals,
		attached,
		nowMs: Date.now(),
	}).find(other => other.terminal.address === terminal.address)
	if (!verdict) return 'it is gone'
	if (verdict.action !== 'close') return verdict.reason
	const screen = await screenFingerprint(terminal.address)
	if (world.memory.marks[terminal.address]?.screen !== screen)
		return 'its screen changed'
	return null
}
