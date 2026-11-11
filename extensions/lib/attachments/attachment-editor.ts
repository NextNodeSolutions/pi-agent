/** Wire attachment ingestion into an editor instance: the prompt editor and
 * the questionnaire dialog's free-text editor share these hooks. */

import { ALIAS_PATTERN, ALIAS_PATTERN_END } from './attachment-store.ts'

import type { KeybindingsManager } from '@earendil-works/pi-coding-agent'
import type { EditorComponent } from '@earendil-works/pi-tui'
import type { AttachmentStore } from './attachment-store.ts'

/** Editable alias styling: accent (image aliases also bold) so aliases read as tokens. */
export type AliasStylist = (alias: string) => string

type AttachmentDecision = {
	store: AttachmentStore
	cwd: string
	styleAlias: AliasStylist
}

/** The editor keypress being processed, or undefined when outside `handleInput`. */
type KeypressReader = () => string | undefined

/** True when this keypress submits the prompt, so the editor clears it as one. */
function isSubmitKey(
	keybindings: Pick<KeybindingsManager, 'matches'>,
	keyInput: string | undefined,
): boolean {
	if (!keyInput) return false
	return keybindings.matches(keyInput, 'tui.input.submit')
}

/**
 * Attach file-path ingestion to an editor instance (prompt or dialog):
 *
 * - `onChange`: new image and PDF paths are rewritten to `[img:N]` / `[pdf:N]`
 *   aliases as they arrive (typing, paste); losing an alias to an edit drops
 *   its capture, a draft emptied by any non-submit key or programmatic
 *   `setText('')` drops every capture in the same keystroke, and the
 *   submit-clear (`onChange('')` fired by the submit keypress) keeps the
 *   captures alive for the input event and consumes them instead. Dialog
 *   wiring replaces that empty-text rule with its combined references.
 * - `handleInput`: backspacing within a trailing alias removes the whole
 *   alias instead of just the last digit.
 * - `render`: aliases are styled through `styleAlias`.
 *
 * onChange is intercepted with accessors because pi reassigns `onChange` and
 * `onSubmit` on the editor (copying callbacks from the default editor) after
 * the editor factory runs; later reassignments must keep calling through.
 */
export function attachPromptFileEditor(
	editor: EditorComponent,
	decision: AttachmentDecision,
	keybindings: Pick<KeybindingsManager, 'matches'>,
): EditorComponent {
	const activeKeyInput = attachAliasBackspace(editor, keybindings)
	attachFileRewrite(editor, decision, keybindings, activeKeyInput)
	attachAliasStyling(editor, decision.styleAlias)
	return editor
}

function attachFileRewrite(
	editor: EditorComponent,
	{ store, cwd }: AttachmentDecision,
	keybindings: Pick<KeybindingsManager, 'matches'>,
	activeKeyInput: KeypressReader,
): void {
	let isRewriting = false
	let upstreamChange: ((text: string) => void) | undefined = undefined
	// Only the submit keypress's clear keeps captures: pi-tui submitValue()
	// fires onChange('') BEFORE onSubmit(result), and the input event must
	// still find them to attach. Any other empty text is a deleted draft
	// (delete-to-line-start, double-Escape clear, programmatic clear) whose
	// captures belong to the strip now, so they drop in the same keystroke.
	const pruneUnreferenced = (text: string): void => {
		if (text) {
			store.retainReferencedAliases(text)
			return
		}
		if (!isSubmitKey(keybindings, activeKeyInput())) store.clearCaptures()
	}
	const handleChange = (text: string): void => {
		if (isRewriting) {
			pruneUnreferenced(text)
			upstreamChange?.(text)
			return
		}
		const rewritten = store.ingestCaptures(text, cwd)
		if (rewritten !== text) {
			// Our own setText fires onChange again; retain instead of re-ingesting.
			isRewriting = true
			try {
				editor.setText(rewritten)
			} finally {
				isRewriting = false
			}
			return
		}
		pruneUnreferenced(text)
		upstreamChange?.(text)
	}
	Object.defineProperty(editor, 'onChange', {
		get: () => handleChange,
		set: next => {
			upstreamChange = next
		},
		configurable: true,
	})
}

/** Backspace inside a trailing alias deletes the whole alias. */
export function attachAliasBackspace(
	editor: EditorComponent,
	keybindings: Pick<KeybindingsManager, 'matches'>,
): KeypressReader {
	let keyInputUnderway: string | undefined
	const originalHandleInput = editor.handleInput.bind(editor)
	// Rebinding is the sanctioned adapter hook for input interception.
	// oxlint-disable-next-line no-param-reassign
	editor.handleInput = (keyInput: string): void => {
		// onChange callbacks fire inside the base handler; expose the keypress
		// so pruneUnreferenced can tell a submit-clear from a deleted draft.
		keyInputUnderway = keyInput
		try {
			const textBefore = editor.getText()
			const trailingAlias = ALIAS_PATTERN_END.exec(textBefore)
			originalHandleInput(keyInput)
			const deletedLastCharacter =
				keybindings.matches(
					keyInput,
					'tui.editor.deleteCharBackward',
				) && editor.getText() === textBefore.slice(0, -1)
			if (deletedLastCharacter && trailingAlias) {
				editor.setText(textBefore.slice(0, trailingAlias.index))
			}
		} finally {
			keyInputUnderway = undefined
		}
	}
	return () => keyInputUnderway
}

/** Restyle alias tokens in every rendered editor line. */
export function attachAliasStyling(
	editor: EditorComponent,
	styleAlias: AliasStylist,
): void {
	const originalRender = editor.render.bind(editor)
	// oxlint-disable-next-line no-param-reassign
	editor.render = (width: number): string[] =>
		originalRender(width).map(line =>
			line.replace(ALIAS_PATTERN, styleAlias),
		)
}
