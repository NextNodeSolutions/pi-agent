import { homedir } from 'node:os'
import { isAbsolute, join, matchesGlob, relative, resolve } from 'node:path'

import { runtimeFor } from '#lib/runtime/runtime.ts'

import { coversPath, isTestPath } from './paths.ts'
import { physicalPath } from './physical-path.ts'

const SEPARATORS = /[\s`'"()[\]<>,;|]+/u
const BOLD = /^\*\*(.+)\*\*$/u
const TRAILING = /(?::\d+)*[.,:;!?]*$/u
const WILDCARD = /[*?{]/u
const HOME = '~/'
const ANY_DIRECTORY = '**/'

type Named = { path: string; isDirectory: boolean }

function namedPath(token: string): Named | undefined {
	const bare = token.replace(BOLD, '$1').replace(TRAILING, '')
	const isTestFileName =
		!bare.includes('/') && bare.includes('.') && isTestPath(bare)
	if (isTestFileName)
		return { path: `${ANY_DIRECTORY}${bare}`, isDirectory: true }
	if (bare.includes('://') || !bare.includes('/')) return undefined
	const expanded = bare.startsWith(HOME)
		? join(homedir(), bare.slice(HOME.length))
		: bare
	return {
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

/** Inside the root a test path or a directory counts; outside it only a test path. */
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

/** The canonical files and directories a consent names; a consent naming none covers the root. */
export async function consentScope(
	root: string,
	texts: readonly string[],
): Promise<string[]> {
	const scopes = await Promise.all(
		texts.toReversed().map(async text => {
			const named = text
				.split(SEPARATORS)
				.flatMap(token => namedPath(token) ?? [])
			const entries = await Promise.all(
				named.map(path => scopeEntry(root, path)),
			)
			return Array.from(new Set(entries.flat()))
		}),
	)
	return scopes.find(scope => scope.length) ?? [root]
}

export function consentCovers(scope: readonly string[], path: string): boolean {
	return scope.some(named =>
		WILDCARD.test(named)
			? matchesGlob(path, named)
			: coversPath([named], path),
	)
}
