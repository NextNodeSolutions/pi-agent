import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { consentScope } from '#lib/test-pace/consent-scope.ts'

const fixture = { root: '' }
const everyPath = async (): Promise<boolean> => true

before(async () => {
	fixture.root = await realpath(
		await mkdtemp(join(tmpdir(), 'consent-scope-')),
	)
	await mkdir(join(fixture.root, 'packages/api'), { recursive: true })
	await mkdir(join(fixture.root, 'tests'))
	await writeFile(join(fixture.root, 'src.ts'), '')
})

after(() => rm(fixture.root, { recursive: true, force: true }))

test('covers a named test file and a named new directory', async () => {
	assert.deepEqual(
		await consentScope(fixture.root, everyPath, [
			'May I edit `tests/cart.test.ts` and move files into src/api/?',
		]),
		[
			join(fixture.root, 'tests/cart.test.ts'),
			join(fixture.root, 'src/api'),
		],
	)
})

test('covers an existing directory named without a trailing slash', async () => {
	assert.deepEqual(
		await consentScope(fixture.root, everyPath, [
			'Allow test moves under packages/api',
		]),
		[join(fixture.root, 'packages/api')],
	)
})

test('reads the scope from the reply as well as the question', async () => {
	assert.deepEqual(
		await consentScope(fixture.root, everyPath, [
			'May I change the tests?',
			'yes, only tests/unit/',
		]),
		[join(fixture.root, 'tests/unit')],
	)
})

test('covers nothing by itself when no path is named', async () => {
	assert.deepEqual(
		await consentScope(fixture.root, everyPath, [
			'ok, add tests for the reducer',
		]),
		[],
	)
})

test('scopes a bare test filename to files of that name anywhere under the root', async () => {
	assert.deepEqual(
		await consentScope(fixture.root, everyPath, [
			'Add a test for src/cart.ts in cart.test.ts?',
		]),
		[join(fixture.root, '**/cart.test.ts')],
	)
})

test('ignores URLs and outside paths that are not tests', async () => {
	assert.deepEqual(
		await consentScope(fixture.root, everyPath, [
			'See https://example.com/tests/x.test.ts and /var/log/notes.md',
		]),
		[],
	)
})

test('keeps a named test path outside the working directory', async () => {
	assert.deepEqual(
		await consentScope(fixture.root, everyPath, [
			'May I edit /elsewhere/tests/a.test.ts:42?',
		]),
		['/elsewhere/tests/a.test.ts'],
	)
})

test('preserves the named glob without broadening to its parent directory', async () => {
	assert.deepEqual(
		await consentScope(fixture.root, everyPath, [
			'Move src/**/*.test.ts into tests/',
		]),
		[join(fixture.root, 'src/**/*.test.ts'), join(fixture.root, 'tests')],
	)
})
