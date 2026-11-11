import type { RoutingSpec } from './spec.ts'

const COMBINING_MARKS = /\p{M}/gu
const NON_WORD = /[^\p{L}\p{N}]+/gu

/** Lowercase words without accents, one space apart: "Réfléchis à fond !" → "reflechis a fond". */
export function normalizeWords(text: string): string {
	return text
		.normalize('NFD')
		.replace(COMBINING_MARKS, '')
		.toLowerCase()
		.replace(NON_WORD, ' ')
		.trim()
}

/** The first group, in spec order, one of whose phrases appears as whole words in the prompt. */
export function pinnedGroup(
	spec: RoutingSpec,
	prompt: string,
): string | undefined {
	const words = ` ${normalizeWords(prompt)} `
	const holds = (phrase: string): boolean => {
		const normalized = normalizeWords(phrase)
		return normalized.length > 0 && words.includes(` ${normalized} `)
	}
	return Object.entries(spec.pins).find(([, phrases]) =>
		phrases.some(holds),
	)?.[0]
}
