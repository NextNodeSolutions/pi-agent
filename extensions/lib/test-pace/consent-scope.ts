import { homedir } from 'node:os'
import { isAbsolute, join, matchesGlob, relative, resolve } from 'node:path'

import { runtimeFor } from '#lib/runtime/runtime.ts'

import { coversPath, isTestPath } from './paths.ts'
import { physicalPath } from './physical-path.ts'

const SEPARATORS = /[\s`'"<>,;|]+|\]\(/u
/** Bold text, not a glob such as `**\/__snapshots__/**`. */
const BOLD = /^\*\*([^/*].*)\*\*$/u
const BRACKETS = [
	['(', ')'],
	['[', ']'],
] as const
const TRAILING = /(?::\d+)*[.,:;!?]*$/u
const WILDCARD = /[*?{]/u
const HOME = '~/'
const ANY_DIRECTORY = '**/'

type Named = { written: string; path: string; isDirectory: boolean }
type PathJudge = (written: string) => Promise<boolean>
export type ConsentPaths = { scope: string[]; excluded: string[] }

function count(token: string, char: string): number {
	return token.split(char).length - 1
}

function closingIndex(
	chars: readonly string[],
	open: string,
	close: string,
): number {
	let depth = 0
	for (const [index, char] of chars.entries()) {
		depth += Number(char === open) - Number(char === close)
		if (depth === 0) return index
	}
	return -1
}

/** Brackets inside a path, as in `app/(marketing)/` or `[slug]/`, belong to it; only those wrapping it in prose go. */
function unwrapped(
	token: string,
	open: string,
	close: string,
): string | undefined {
	const chars = Array.from(token)
	if (chars[0] === open) {
		const end = closingIndex(chars, open, close)
		if (end === -1) return token.slice(1)
		if (end === chars.length - 1) return token.slice(1, -1)
	}
	const isUnmatched = count(token, close) > count(token, open)
	if (!token.endsWith(close) || !isUnmatched) return undefined
	return token.slice(0, -1)
}

function trimmed(token: string): string {
	const bare = token.replace(TRAILING, '')
	const inner = BRACKETS.map(([open, close]) =>
		unwrapped(bare, open, close),
	).find(found => found)
	return inner ? trimmed(inner) : bare
}

function namedPath(token: string): Named | undefined {
	const bare = trimmed(token.replace(BOLD, '$1'))
	const isTestFileName =
		!bare.includes('/') && bare.includes('.') && isTestPath(bare)
	if (isTestFileName)
		return {
			written: bare,
			path: `${ANY_DIRECTORY}${bare}`,
			isDirectory: true,
		}
	if (bare.includes('://') || !bare.includes('/')) return undefined
	const expanded = bare.startsWith(HOME)
		? join(homedir(), bare.slice(HOME.length))
		: bare
	return {
		written: bare,
		path: expanded,
		isDirectory: WILDCARD.test(expanded) || expanded.endsWith('/'),
	}
}

async function isExistingDirectory(path: string): Promise<boolean> {
	const runtime = runtimeFor(path)
	return (
		(await runtime.exists(path)) && (await runtime.stat(path)).isDirectory
	)
}

async function canonical(path: string): Promise<string | undefined> {
	try {
		return await physicalPath(path)
	} catch {
		return undefined
	}
}

async function scopeEntry(root: string, named: Named): Promise<string[]> {
	const path = await canonical(resolve(root, named.path))
	if (!path) return []
	const local = relative(root, path)
	if (local.startsWith('..') || isAbsolute(local))
		return isTestPath(path) ? [path] : []
	const counts =
		named.isDirectory ||
		isTestPath(local) ||
		(await isExistingDirectory(path))
	return counts ? [path] : []
}

async function judgedPaths(
	root: string,
	isCovered: PathJudge,
	text: string,
): Promise<{ covered: string[]; context: string[] }> {
	const named = new Map(
		text
			.split(SEPARATORS)
			.flatMap(token => namedPath(token) ?? [])
			.map(candidate => [candidate.written, candidate]),
	)
	const entries = await Promise.all(
		[...named.values()].map(async candidate => {
			const paths = await scopeEntry(root, candidate)
			return {
				paths,
				isCovered:
					paths.length > 0 && (await isCovered(candidate.written)),
			}
		}),
	)
	const covered = entries.filter(entry => entry.isCovered)
	const context = entries.filter(entry => !entry.isCovered)
	return {
		covered: Array.from(new Set(covered.flatMap(entry => entry.paths))),
		context: Array.from(new Set(context.flatMap(entry => entry.paths))),
	}
}

/** The last text naming a covered path decides the scope; an exchange naming none covers nothing by itself (`consent.ts` gives it the earlier grants' scope). */
export async function consentPaths(
	root: string,
	isCovered: PathJudge,
	texts: readonly string[],
): Promise<ConsentPaths> {
	const judged = new Map<string, Promise<boolean>>()
	const judgeOnce: PathJudge = written => {
		const pending = judged.get(written) ?? isCovered(written)
		judged.set(written, pending)
		return pending
	}
	return texts.toReversed().reduce<Promise<ConsentPaths>>(
		async (found, text) => {
			const newer = await found
			if (newer.scope.length) return newer
			const { covered, context } = await judgedPaths(
				root,
				judgeOnce,
				text,
			)
			return {
				scope: covered,
				excluded: Array.from(new Set([...newer.excluded, ...context])),
			}
		},
		Promise.resolve({ scope: [], excluded: [] }),
	)
}

export async function consentScope(
	root: string,
	isCovered: PathJudge,
	texts: readonly string[],
): Promise<string[]> {
	return (await consentPaths(root, isCovered, texts)).scope
}

function specificity(named: readonly string[], path: string): number {
	return Math.max(
		-1,
		...named
			.filter(entry =>
				WILDCARD.test(entry)
					? matchesGlob(path, entry)
					: coversPath(entry, path),
			)
			.map(entry => entry.length),
	)
}

/** The most specific named path decides: a context path inside the scope carves it out, a broader one does not. */
export function consentCovers(
	consent: { scope: readonly string[]; excluded?: readonly string[] },
	path: string,
): boolean {
	return (
		specificity(consent.scope, path) >
		specificity(consent.excluded ?? [], path)
	)
}
