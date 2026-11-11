/**
 * route - target Magpie groups from one file, `magpie-routing.json` in the agent dir.
 *
 * The spec holds the router group's members (also its no-match order), the intents its
 * classifier labels, the ordered rules sending an intent or a folder scope to groups, and
 * pin phrases. `/route apply` writes it into Magpie, replacing every router rule. A human
 * prompt holding a pin phrase ("use best intelligence") pins that group for the session:
 * each request bound for the router goes to it instead, so a directive never loses to the
 * classifier's topic label. `/route <group>` pins by hand, `/route auto` releases.
 *
 * Modules: session.ts (the session's spec and pin), spec.ts (schema and cross-checks),
 * pin.ts (phrase match), apply.ts (Magpie CLI writes with backup and verification),
 * summary.ts (command text and completions).
 */
import { isHumanPrompt } from '#lib/human-prompt.ts'

import { RouteSession } from './session.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function route(pi: ExtensionAPI): void {
	const session = new RouteSession(pi)
	pi.on('session_start', (_event, ctx) => session.load(ctx))
	pi.on('session_tree', (_event, ctx) => session.restore(ctx))
	pi.on('input', (event, ctx) => {
		if (isHumanPrompt(event)) session.pinFromPrompt(event.text, ctx)
	})
	pi.on('before_provider_request', event => session.rerouted(event.payload))
	pi.registerCommand('route', {
		description:
			'Magpie routing: show it, pin a group, auto releases, apply writes magpie-routing.json',
		getArgumentCompletions: prefix => session.completions(prefix),
		handler: (args, ctx) => session.run(args.trim(), ctx),
	})
}
