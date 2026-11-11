/**
 * Lifetime of a dialog that blocks the agent on a human: the custom TUI
 * component, abort wiring and the terminal program status. Shared by the
 * questionnaire and the secret prompt; the content of each dialog stays with
 * its owner.
 */
import type {
	ExtensionContext,
	KeybindingsManager,
	Theme,
} from '@earendil-works/pi-coding-agent'
import type {
	Component,
	ProgramStatus,
	Terminal,
	TUI,
} from '@earendil-works/pi-tui'

export type DialogComponent = Component & { dispose?(): void }

export type DialogFactory<T> = (
	tui: TUI,
	theme: Theme,
	keybindings: KeybindingsManager,
	done: (result: T) => void,
) => DialogComponent

export interface HumanDialog<T> {
	readonly build: DialogFactory<T>
	/** The result an external abort reports in place of a human answer. */
	readonly cancelled: () => T
	/** Program-status message while the dialog waits, e.g. "Waiting for an answer". */
	readonly waitingMessage: string
}

export async function showHumanDialog<T>(
	context: ExtensionContext,
	signal: AbortSignal | undefined,
	dialog: HumanDialog<T>,
): Promise<T> {
	let terminal: Terminal | undefined
	let removeAbortListener: (() => void) | undefined
	signal?.throwIfAborted()
	try {
		const outcome = await context.ui.custom<T>(
			(tui, theme, keybindings, done) => {
				const component = dialog.build(tui, theme, keybindings, done)
				const abort = (): void => done(dialog.cancelled())
				if (signal?.aborted) {
					abort()
					return component
				}
				signal?.addEventListener('abort', abort, { once: true })
				removeAbortListener = () =>
					signal?.removeEventListener('abort', abort)
				terminal = tui.terminal
				terminal.setProgramStatus({
					app: 'pi',
					state: 'blocked',
					kind: 'question',
					message: dialog.waitingMessage,
				})
				return component
			},
		)
		signal?.throwIfAborted()
		return outcome
	} finally {
		removeAbortListener?.()
		restoreProgramStatus(terminal, context, signal)
	}
}

function restoreProgramStatus(
	terminal: Terminal | undefined,
	context: ExtensionContext,
	signal: AbortSignal | undefined,
): void {
	if (!terminal || signal?.aborted || context.isIdle()) return
	const status: ProgramStatus = { app: 'pi', state: 'working' }
	const message = context.sessionManager.getSessionName()
	if (typeof message === 'string') status.message = message
	terminal.setProgramStatus(status)
}
