import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { gitHead, gitStatusEntries, gitTopLevel } from './lib-fingerprint.ts'
import { runProcess } from './lib-process.ts'

import type { StatusEntry } from './lib-fingerprint.ts'
import type { FingerprintScope } from './lib-state.ts'

const UNTRACKED_CODE = '??'
const FILE_DIFF_LIMIT_BYTES = 65_536
const GIT_TIMEOUT_MS = 60_000
const DIFF_EXIT_CODES = new Set([0, 1])
const EMPTY_SIDE = '/dev/null'
const SECRET_PATH =
	/(^|\/)(\.env(\..*)?|[^/]*\.(pem|key|p12|pfx)|[^/]*(secret|credential)[^/]*)$/i

function gitDiff(cwd: string, diffArguments: readonly string[]): string {
	const outcome = runProcess({
		command: 'git',
		arguments: ['diff', ...diffArguments],
		cwd,
		timeoutMs: GIT_TIMEOUT_MS,
	})
	if (outcome.exitCode === null || !DIFF_EXIT_CODES.has(outcome.exitCode))
		return `git diff failed for ${diffArguments.at(-1)}: ${outcome.stderr.trim()}\n`
	return outcome.stdout
}

function additionDiff(cwd: string, path: string): string {
	return gitDiff(cwd, ['--no-index', '--', EMPTY_SIDE, path])
}

function guardedDiff(path: string, produce: () => string): string {
	if (SECRET_PATH.test(path))
		return `diff for ${path} omitted: the path looks like a secret store. The fingerprint covers the file.\n`
	const diff = produce()
	const bytes = Buffer.byteLength(diff)
	if (bytes <= FILE_DIFF_LIMIT_BYTES) return diff
	return `diff for ${path} omitted: ${bytes} bytes exceed the ${FILE_DIFF_LIMIT_BYTES} byte limit. The fingerprint covers the file; ask for excerpts.\n`
}

function changedPathDiff(topLevel: string, entry: StatusEntry): string {
	return guardedDiff(entry.path, () =>
		entry.code === UNTRACKED_CODE
			? additionDiff(topLevel, entry.path)
			: gitDiff(topLevel, ['HEAD', '--', entry.path]),
	)
}

function explicitPathDiff(cwd: string, path: string): string {
	const absolute = resolve(path)
	if (!existsSync(absolute)) return `${path} is absent.\n`
	return guardedDiff(path, () => additionDiff(cwd, absolute))
}

function treeMaterial(repo: string): string[] {
	const topLevel = gitTopLevel(repo)
	if (!topLevel) return [`${repo} is not a git work tree: no diff recorded.`]
	const entries = gitStatusEntries(repo)
	const heading = `repo ${topLevel} at ${gitHead(repo)}`
	if (!entries.length) return [`${heading}: no uncommitted change.`]
	return [
		`${heading}, ${entries.length} changed path(s)`,
		...entries.map(entry => changedPathDiff(topLevel, entry)),
	]
}

function explicitMaterial(repo: string, paths: readonly string[]): string[] {
	if (!paths.length) return []
	return [
		`${paths.length} explicit --path file(s), each whole as an addition`,
		...paths.map(path => explicitPathDiff(repo, path)),
	]
}

export function recordMaterial(scope: FingerprintScope): string {
	return [
		...treeMaterial(scope.repo),
		...explicitMaterial(scope.repo, scope.paths),
	].join('\n')
}
