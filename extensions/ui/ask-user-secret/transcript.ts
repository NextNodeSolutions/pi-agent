/** Pending and settled cards for ask_user_secret; neither ever holds a value. */
import { Value } from 'typebox/value'

import { DETAIL_INDENT, INSET } from '#lib/ui/align.ts'
import { uiTheme } from '#lib/ui/design-system/theme.ts'
import { blockTitle, framedBlock, frameContentWidth } from '#lib/ui/frame.ts'
import { GLYPH } from '#lib/ui/selection-marker.ts'
import { pushWrapped } from '#lib/ui/terminal-text.ts'

import { SecretParams, SecretResultSchema } from './schema.ts'

import type { SecretResult } from './schema.ts'

export function parseSecretResult(raw: unknown): SecretResult | undefined {
	try {
		return Value.Parse(SecretResultSchema, raw)
	} catch {
		return undefined
	}
}

function purposeLine(args: unknown): { kind: string; purpose: string } {
	if (Value.Check(SecretParams, args))
		return { kind: args.kind, purpose: args.purpose }
	return { kind: 'secret', purpose: '' }
}

export function renderCallLines(args: unknown, width: number): string[] {
	const { kind, purpose } = purposeLine(args)
	const lines: string[] = []
	pushWrapped(
		line => lines.push(line),
		INSET,
		purpose
			? uiTheme.fg('text', purpose)
			: uiTheme.fg('dim', 'waiting for the request…'),
		frameContentWidth(width),
	)
	return framedBlock({
		width,
		title: blockTitle('secret', kind),
		lines,
		footer: uiTheme.fg('dim', 'awaiting input'),
	})
}

export function renderResultLines(
	details: SecretResult,
	width: number,
): string[] {
	const lines: string[] = ['']
	const sink = (line: string): void => {
		lines.push(line)
	}
	const contentWidth = frameContentWidth(width)
	const [icon, status, note] = settled(details)
	pushWrapped(sink, DETAIL_INDENT, uiTheme.fg('dim', note), contentWidth)
	lines.push('')
	return framedBlock({
		width,
		title: `${icon} ${blockTitle('secret', status)}`,
		lines,
		footer: uiTheme.fg('dim', status),
	})
}

function settled(details: SecretResult): [string, string, string] {
	switch (details.status) {
		case 'issued':
			return [
				uiTheme.fg('success', GLYPH.done),
				'issued',
				`· one-time handle for ${details.origin}`,
			]
		case 'stored':
			return [
				uiTheme.fg('success', GLYPH.done),
				'stored',
				`· ${details.operation} in ${details.target}`,
			]
		case 'cancelled':
			return [
				uiTheme.fg('danger', GLYPH.cancel),
				'cancelled',
				'· no value',
			]
	}
}
