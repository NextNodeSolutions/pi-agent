import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { consentScope } from '#lib/test-pace/consent-scope.ts'

const fixture = { root: '' }

before(async () => {
	fixture.root = await realpath(
		await mkdtemp(join(tmpdir(), 'consent-scope-brackets-')),
	)
})

after(() => rm(fixture.root, { recursive: true, force: true }))

test('covers only the named file when a directory name has parentheses', async () => {
	assert.deepEqual(
		await consentScope(fixture.root, [
			'May I update app/(marketing)/page.test.tsx?',
			'ok',
		]),
		[join(fixture.root, 'app/(marketing)/page.test.tsx')],
	)
})

test('covers only the named file when a directory name has square brackets', async () => {
	assert.deepEqual(
		await consentScope(fixture.root, [
			'May I update app/routes/[slug]/page.test.tsx?',
		]),
		[join(fixture.root, 'app/routes/[slug]/page.test.tsx')],
	)
})

test('keeps a glob that starts and ends with a double star', async () => {
	assert.deepEqual(
		await consentScope(fixture.root, [
			'Allow edits under **/__snapshots__/** only',
		]),
		[join(fixture.root, '**/__snapshots__/**')],
	)
})

test('drops the brackets and punctuation wrapped around a path in prose', async () => {
	assert.deepEqual(
		await consentScope(fixture.root, [
			'Fix the import (in tests/cart.test.ts). Also see [tests/user.test.ts:12].',
		]),
		[
			join(fixture.root, 'tests/cart.test.ts'),
			join(fixture.root, 'tests/user.test.ts'),
		],
	)
})
