import { attachedTerminals } from './attention.ts'
import { decide } from './decide.ts'
import { liveTerminals, screenFingerprint } from './hc.ts'

import type { World } from './decide.ts'
import type { SweepOptions } from './sweep.ts'
import type { Terminal } from './terminal.ts'

export async function mayClose(
	terminal: Terminal,
	world: World,
	options: SweepOptions,
): Promise<boolean> {
	const terminals = await liveTerminals()
	const current = terminals.find(other => other.address === terminal.address)
	if (JSON.stringify(current) !== JSON.stringify(terminal)) return false
	const attached = await attachedTerminals(options.attached, options.window)
	const verdict = decide({
		...world,
		terminals,
		attached,
		nowMs: Date.now(),
	}).find(other => other.terminal.address === terminal.address)
	if (verdict?.action !== 'close') return false
	const screen = await screenFingerprint(terminal.address)
	return world.memory.marks[terminal.address]?.screen === screen
}
