import { GROUP_PREFIX, MAGPIE_PROVIDER } from '#lib/magpie.ts'
import { PI_PALETTE as LATTE } from '#lib/ui/design-system/palette.ts'
import { foregroundHex as fgHex } from '#lib/ui/design-system/terminal-color.ts'

import { quietText as QUIET } from './text.ts'

// Magpie echoes the group in the stream body; only this header names the model
const SERVED_MODEL_HEADER = 'x-magpie-model'

export type MagpieServed = { group: string; model: string }

export type MagpieRoute = { group: string; model: string | undefined }

export function servedModel(
	provider: string | undefined,
	group: string | undefined,
	headers: Readonly<Record<string, string>>,
): MagpieServed | undefined {
	const model = headers[SERVED_MODEL_HEADER]
	if (provider !== MAGPIE_PROVIDER || !group || !model) return undefined
	return { group, model }
}

/** A model served under another group never labels the active one. */
export function magpieRoute(
	provider: string | undefined,
	group: string | undefined,
	served: MagpieServed | null,
): MagpieRoute | undefined {
	if (provider !== MAGPIE_PROVIDER || !group) return undefined
	return { group, model: served?.group === group ? served.model : undefined }
}

export function magpieRouteSegment(route: MagpieRoute): string {
	const group = route.group.startsWith(GROUP_PREFIX)
		? route.group.slice(GROUP_PREFIX.length)
		: route.group
	const model = route.model
		? fgHex(LATTE.text, route.model)
		: fgHex(LATTE.overlay1, 'no reply yet')
	return `${QUIET(group)} ${fgHex(LATTE.overlay1, '→')} ${model}`
}
