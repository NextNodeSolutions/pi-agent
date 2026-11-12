import { dirname, isAbsolute, relative, resolve } from 'node:path'

import { runtimeFor } from '#lib/runtime/runtime.ts'

import { physicalPath } from './physical-path.ts'

import type { Runtime } from '#lib/runtime/runtime.ts'

const TEST_PATH =
	/(?:^|\/)(?:__tests__|tests?|specs?|fixtures?|__fixtures__|__mocks__|__snapshots__|e2e|cypress|playwright)(?:\/|$)|(?:^|\/)(?:test_[^/]+|[^/]+(?:[._-](?:test|spec)|_test))\.[^/]+$|(?:^|\/)(?:conftest\.py|(?:pytest|tox)\.ini|\.mocharc[^/]*|[^/]+\.snap|(?:vitest|jest|playwright|cypress|pytest|ava|karma|nyc)[^/]*\.(?:[cm]?[jt]s|json|toml|ini))$/i
const END_TO_END_PATH = /(?:^|\/)(?:e2e|cypress|playwright)(?:\/|\.)|[.-]e2e\./i
export const NODE_TEST_RUNNER =
	/\b(?:vitest|jest|ava|mocha|tap|tape|uvu)\b|\b(?:node|tsx)\s+[^\n]*--test\b|\bbun\s+test\b/
const TEST_CASE =
	/(?:^|\/)(?:test_[^/]+\.py|[^/]+(?:[._-](?:test|spec)|_test)\.(?:[cm]?[jt]sx?|go|py|rb))$|(?:^|\/)tests\/[^/]+\.rs$/i
const RESTRICTED_SETUP =
	/(?:^|\/)(?:fixtures?|__fixtures__|__mocks__)(?:\/|$)|(?:^|\/)(?:conftest\.|(?:vitest|jest|playwright|cypress|pytest|ava|karma|nyc)[^/]*\.)/i

export function isTestPath(path: string): boolean {
	return TEST_PATH.test(path.replaceAll('\\', '/'))
}

export function isEndToEndPath(path: string): boolean {
	return END_TO_END_PATH.test(path)
}

export async function targetPaths(
	cwd: string,
	paths: readonly string[],
	scope: 'tests' | 'permission' = 'tests',
): Promise<string[]> {
	if (!paths.length)
		throw new Error('Name at least one exact target test path.')
	const root = await physicalPath(cwd)
	const canonical = await Promise.all(
		paths.map(path => physicalPath(resolve(cwd, path))),
	)
	return [...new Set(canonical)].map(path => {
		const local = relative(root, path)
		if (
			!local ||
			local.startsWith('..') ||
			isAbsolute(local) ||
			(scope === 'tests' && !isTestPath(local))
		)
			throw new Error(
				'Target must be an exact test path inside the working directory.',
			)
		return path
	})
}

export async function packageRunner(path: string): Promise<string | undefined> {
	return runnerAbove(runtimeFor(path), dirname(path))
}

async function runnerAbove(
	runtime: Runtime,
	directory: string,
): Promise<string | undefined> {
	const manifests = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']
	const present = await Promise.all(
		manifests.map(name => runtime.exists(resolve(directory, name))),
	)
	const manifest = manifests.find((_name, index) => present[index])
	if (!manifest) {
		if (await runtime.exists(resolve(directory, '.git'))) return undefined
		const parent = dirname(directory)
		if (parent === directory) return undefined
		return runnerAbove(runtime, parent)
	}
	if (manifest === 'Cargo.toml') return 'cargo test'
	if (manifest === 'go.mod') return 'go test'
	const content = (
		await runtime.readFile(resolve(directory, manifest))
	).toString()
	if (manifest === 'package.json') return nodeRunner(content)
	if (/\bpytest\b/.test(content)) return 'pytest'
	return undefined
}

function nodeRunner(content: string): string | undefined {
	const manifest: unknown = JSON.parse(content)
	const scripts: unknown = Reflect.get(Object(manifest), 'scripts')
	if (!scripts || typeof scripts !== 'object') return undefined
	return Object.entries(scripts).find(
		([name, command]) =>
			/^test(?::|$)/.test(name) &&
			typeof command === 'string' &&
			hasConfiguredRunner(manifest, command),
	)?.[0]
}

function hasConfiguredRunner(manifest: unknown, command: string): boolean {
	if (
		/(?:^|&&|\|\||;)\s*(?:node\b[^;&|\n]*--test\b|bun\s+test\b)/.test(
			command,
		)
	)
		return true
	if (!NODE_TEST_RUNNER.test(command)) return false
	return ['dependencies', 'devDependencies'].some(section =>
		Object.keys(Object(Reflect.get(Object(manifest), section))).some(
			name => NODE_TEST_RUNNER.test(name) && command.includes(name),
		),
	)
}

export async function ineligibleTarget(
	path: string,
	createdPaths: readonly string[] = [],
): Promise<string | undefined> {
	if (!TEST_CASE.test(path) || RESTRICTED_SETUP.test(path))
		return 'Only new test cases qualify. Test setup, helpers and fixtures need explicit human authorization.'
	if (isEndToEndPath(path))
		return 'End-to-end tests require explicit human authorization.'
	if (!createdPaths.includes(path) && (await runtimeFor(path).exists(path)))
		return 'An existing test requires explicit human authorization to change.'
	if (!(await packageRunner(path)))
		return 'The target package has no recognized existing test runner.'
	return undefined
}
