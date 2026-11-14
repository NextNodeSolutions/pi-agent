import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Dirent } from 'node:fs'

const UPSTREAM_URL = 'https://github.com/kuratlielia/arc-library.git'
const DEFAULT_REF = 'main'
const ARC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'arc')
const SOURCE_FILE = join(ARC_DIR, 'SOURCE.md')
const LOCAL_ONLY_FILES = new Set(['nextnode.css', 'SOURCE.md'])
const PINNED_COMMIT_PATTERN = /`([0-9a-f]{40})`/

const print = (line: string): void => {
	process.stdout.write(`${line}\n`)
}

const git = (checkout: string, args: readonly string[]): string =>
	execFileSync('git', ['-C', checkout, ...args], {
		encoding: 'utf8',
	}).trimEnd()

const readPinnedCommit = (): string => {
	const pinned = PINNED_COMMIT_PATTERN.exec(
		readFileSync(SOURCE_FILE, 'utf8'),
	)?.[1]
	if (!pinned) {
		throw new Error(
			`Expected the copied upstream commit as a 40-character hash in backticks in ${SOURCE_FILE}; record it there first.`,
		)
	}
	return pinned
}

const toUpstreamPath = (entry: Dirent): string | null => {
	if (entry.isDirectory()) return `registry/components/${entry.name}`
	if (LOCAL_ONLY_FILES.has(entry.name)) return null
	if (entry.name === 'LICENSE') return 'LICENSE'
	return `registry/${entry.name}`
}

const listCopiedUpstreamPaths = (): string[] =>
	readdirSync(ARC_DIR, { withFileTypes: true })
		.map(toUpstreamPath)
		.filter((path): path is string => path !== null)
		.toSorted()

const fetchCommit = (checkout: string, ref: string): string => {
	git(checkout, ['fetch', '--quiet', '--depth', '1', 'origin', ref])
	return git(checkout, ['rev-parse', 'FETCH_HEAD'])
}

const assertPresentUpstream = (
	checkout: string,
	commit: string,
	paths: readonly string[],
): void => {
	const missing = paths.filter(path => {
		try {
			git(checkout, ['cat-file', '-e', `${commit}:${path}`])
			return false
		} catch {
			return true
		}
	})
	if (missing.length > 0) {
		throw new Error(
			`Expected every file in ${ARC_DIR} to exist upstream at ${commit}; missing: ${missing.join(', ')}. Add local-only files to LOCAL_ONLY_FILES.`,
		)
	}
}

const reportChanges = (
	checkout: string,
	pinned: string,
	latest: string,
	paths: readonly string[],
): void => {
	const stat = git(checkout, [
		'diff',
		'--stat',
		pinned,
		latest,
		'--',
		...paths,
	])
	if (stat === '') {
		print(
			`None of the copied files changed between ${pinned} and ${latest}.`,
		)
		return
	}
	print(
		`Upstream changes to the copied files, ${pinned} -> ${latest}:\n${stat}\n`,
	)
	execFileSync(
		'git',
		['-C', checkout, '--no-pager', 'diff', pinned, latest, '--', ...paths],
		{
			stdio: 'inherit',
		},
	)
}

const main = (): void => {
	const [, , ref = DEFAULT_REF] = process.argv
	const pinned = readPinnedCommit()
	const paths = listCopiedUpstreamPaths()
	const checkout = mkdtempSync(join(tmpdir(), 'arc-upstream-'))
	git(checkout, ['init', '--quiet'])
	git(checkout, ['remote', 'add', 'origin', UPSTREAM_URL])
	fetchCommit(checkout, pinned)
	const latest = fetchCommit(checkout, ref)
	assertPresentUpstream(checkout, pinned, paths)
	if (latest === pinned)
		print(`The copy is current: ${ref} is still ${pinned}.`)
	else reportChanges(checkout, pinned, latest, paths)
	git(checkout, ['checkout', '--quiet', latest])
	print(`\nUpstream checkout of ${ref} (${latest}): ${checkout}`)
}

main()
