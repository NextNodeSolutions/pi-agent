import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { errorText } from '#lib/error-text.ts'
import { typedPromptText } from '#lib/human-prompt.ts'
import { GROUP_PREFIX } from '#lib/magpie.ts'

import { applyRoutingSpec } from './apply.ts'
import { pinnedGroup } from './pin.ts'
import { loadRoutingSpec, SPEC_FILE } from './spec.ts'
import { APPLY, describeRouting, RELEASE, routeCompletions } from './summary.ts'

import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { AutocompleteItem } from '@earendil-works/pi-tui'
import type { RoutingSpec } from './spec.ts'

const PIN_ENTRY = 'route-pin'
const STATUS_KEY = 'route'
const PinEntrySchema = Type.Object({ group: Type.String() })
const RoutedPayloadSchema = Type.Object({ model: Type.String() })

export class RouteSession {
	private readonly pi: ExtensionAPI
	private spec: RoutingSpec | undefined
	private pin: string | undefined

	constructor(pi: ExtensionAPI) {
		this.pi = pi
	}

	load(ctx: ExtensionContext): void {
		try {
			this.spec = loadRoutingSpec(getAgentDir())
		} catch (error) {
			this.spec = undefined
			ctx.ui.notify(`route: ${errorText(error)}`, 'warning')
		}
		this.restore(ctx)
	}

	restore(ctx: ExtensionContext): void {
		this.pin = this.storedPin(ctx)
		this.showPin(ctx)
	}

	pinFromPrompt(prompt: string, ctx: ExtensionContext): void {
		const pin = this.spec && pinnedGroup(this.spec, typedPromptText(prompt))
		if (!pin || pin === this.pin) return
		this.setPin(ctx, pin)
		ctx.ui.notify(
			`Pinned ${pin} for this session: /route ${RELEASE} releases it`,
			'info',
		)
	}

	/** Only a request bound for the router moves; any other payload goes back as it came. */
	rerouted(payload: unknown): unknown {
		if (!this.spec || !this.pin) return payload
		if (!Value.Check(RoutedPayloadSchema, payload)) return payload
		if (payload.model !== `${GROUP_PREFIX}${this.spec.group}`)
			return payload
		return { ...payload, model: this.pin }
	}

	completions(prefix: string): AutocompleteItem[] | null {
		if (!this.spec) return null
		return routeCompletions(this.spec, prefix)
	}

	async run(argument: string, ctx: ExtensionContext): Promise<void> {
		if (argument === APPLY) {
			await this.apply(ctx)
			return
		}
		if (!this.spec) {
			ctx.ui.notify(
				`${SPEC_FILE} did not load: fix it, then /route ${APPLY}`,
				'error',
			)
			return
		}
		if (!argument) {
			ctx.ui.notify(describeRouting(this.spec, this.pin), 'info')
			return
		}
		this.pinByHand(this.spec, argument, ctx)
	}

	private async apply(ctx: ExtensionContext): Promise<void> {
		try {
			const spec = loadRoutingSpec(getAgentDir())
			const report = await applyRoutingSpec(spec, getAgentDir())
			this.spec = spec
			this.restore(ctx)
			ctx.ui.notify(
				`Applied ${report.added} rules to ${GROUP_PREFIX}${spec.group}, replacing ${report.replaced}; backup ${report.backup}`,
				'info',
			)
		} catch (error) {
			ctx.ui.notify(`route apply failed: ${errorText(error)}`, 'error')
		}
	}

	private pinByHand(
		spec: RoutingSpec,
		argument: string,
		ctx: ExtensionContext,
	): void {
		if (argument === RELEASE) {
			this.setPin(ctx, undefined)
			ctx.ui.notify(
				`Pin released: ${GROUP_PREFIX}${spec.group} classifies each turn again`,
				'info',
			)
			return
		}
		const group = argument.startsWith(GROUP_PREFIX)
			? argument
			: `${GROUP_PREFIX}${argument}`
		if (!spec.members.includes(group)) {
			ctx.ui.notify(
				`${group} is not a member of ${GROUP_PREFIX}${spec.group}: ${spec.members.join(', ')}`,
				'error',
			)
			return
		}
		this.setPin(ctx, group)
		ctx.ui.notify(
			`Pinned ${group} for this session: /route ${RELEASE} releases it`,
			'info',
		)
	}

	private setPin(ctx: ExtensionContext, pin: string | undefined): void {
		this.pin = pin
		this.pi.appendEntry(PIN_ENTRY, { group: pin })
		this.showPin(ctx)
	}

	private showPin(ctx: ExtensionContext): void {
		ctx.ui.setStatus(
			STATUS_KEY,
			this.pin ? `pinned ${this.pin}` : undefined,
		)
	}

	/** A release is stored as an entry without a group, so the latest entry decides. */
	private storedPin(ctx: ExtensionContext): string | undefined {
		const entry = ctx.sessionManager
			.getBranch()
			.findLast(
				candidate =>
					candidate.type === 'custom' &&
					candidate.customType === PIN_ENTRY,
			)
		if (entry?.type !== 'custom') return undefined
		if (!Value.Check(PinEntrySchema, entry.data)) return undefined
		if (!this.spec?.members.includes(entry.data.group)) return undefined
		return entry.data.group
	}
}
