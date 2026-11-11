/**
 * Masked single-line entry. The pi-tui Input owns editing and bracketed
 * paste; this component never renders its value, only one dot per character.
 */
import { Input } from '@earendil-works/pi-tui'

import { INSET } from '#lib/ui/align.ts'
import { uiTheme } from '#lib/ui/design-system/theme.ts'
import { blockTitle, framedBlock, frameContentWidth } from '#lib/ui/frame.ts'
import { showHumanDialog } from '#lib/ui/human-dialog.ts'
import { pushWrapped } from '#lib/ui/terminal-text.ts'

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { Component, Focusable, TUI } from '@earendil-works/pi-tui'
import type { DialogComponent } from '#lib/ui/human-dialog.ts'

export const MAX_SECRET_LENGTH = 4096
const ENTRY_TIMEOUT_MS = 300_000
const MASK = '•'
const CURSOR = '▏'

export interface SecretPrompt {
	readonly kind: string
	readonly purpose: string
	readonly destination: string
}

class SecretDialog implements Component, Focusable, DialogComponent {
	private readonly input = new Input()
	private readonly timer: NodeJS.Timeout
	private settled = false

	constructor(
		private readonly tui: TUI,
		private readonly prompt: SecretPrompt,
		private readonly done: (value: string | undefined) => void,
	) {
		this.input.onSubmit = typed => this.submit(typed)
		this.input.onEscape = () => this.finish(undefined)
		this.timer = setTimeout(() => this.finish(undefined), ENTRY_TIMEOUT_MS)
	}

	get focused(): boolean {
		return this.input.focused
	}

	set focused(isFocused: boolean) {
		this.input.focused = isFocused
	}

	handleInput(keystrokes: string): void {
		this.input.handleInput(keystrokes)
		this.tui.requestRender()
	}

	invalidate(): void {
		this.input.invalidate()
	}

	render(width: number): string[] {
		const contentWidth = frameContentWidth(width)
		const lines: string[] = ['']
		const sink = (line: string): void => {
			lines.push(line)
		}
		pushWrapped(
			sink,
			INSET,
			uiTheme.fg('text', this.prompt.purpose),
			contentWidth,
		)
		pushWrapped(
			sink,
			INSET,
			uiTheme.fg('dim', `→ ${this.prompt.destination}`),
			contentWidth,
		)
		lines.push('')
		const { length } = this.input.getValue()
		const tooLong = length > MAX_SECRET_LENGTH
		pushWrapped(
			sink,
			`${INSET}${uiTheme.fg('accent', '> ')}`,
			uiTheme.fg(tooLong ? 'danger' : 'text', MASK.repeat(length)) +
				uiTheme.fg('accent', CURSOR),
			contentWidth,
		)
		lines.push('')
		return framedBlock({
			width,
			title: blockTitle('secret', this.prompt.kind),
			lines,
			footer: uiTheme.fg(
				'dim',
				tooLong
					? `too long: ${MAX_SECRET_LENGTH} characters maximum`
					: 'Enter submits · Esc cancels · never echoed, never logged',
			),
		})
	}

	dispose(): void {
		clearTimeout(this.timer)
		this.input.setValue('')
	}

	private submit(typed: string): void {
		if (!typed.length || typed.length > MAX_SECRET_LENGTH) {
			this.tui.requestRender()
			return
		}
		this.finish(typed)
	}

	private finish(typed: string | undefined): void {
		if (this.settled) return
		this.settled = true
		clearTimeout(this.timer)
		this.input.setValue('')
		this.done(typed)
	}
}

/** Resolves to the typed value, or undefined on Escape, abort or timeout. */
export function showSecretDialog(
	context: ExtensionContext,
	signal: AbortSignal | undefined,
	prompt: SecretPrompt,
): Promise<string | undefined> {
	return showHumanDialog<string | undefined>(context, signal, {
		build: (tui, _theme, _keybindings, done) =>
			new SecretDialog(tui, prompt, done),
		cancelled: () => undefined,
		waitingMessage: 'Waiting for a secret',
	})
}
