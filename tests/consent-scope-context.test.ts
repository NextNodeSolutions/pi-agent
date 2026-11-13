import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { consentScope } from '#lib/test-pace/consent-scope.ts'

const fixture = { root: '' }

before(async () => {
	fixture.root = await realpath(
		await mkdtemp(join(tmpdir(), 'consent-scope-context-')),
	)
	await mkdir(join(fixture.root, 'src'))
	await mkdir(join(fixture.root, 'tests/e2e'), { recursive: true })
})

after(() => rm(fixture.root, { recursive: true, force: true }))

function coveringOnly(...covered: string[]) {
	return async (written: string): Promise<boolean> =>
		covered.includes(written)
}

test('leaves out a directory the exchange names only as context', async () => {
	assert.deepEqual(
		await consentScope(fixture.root, coveringOnly('tests/math.test.ts'), [
			'May I update tests/math.test.ts each time a rename in src/ touches it?',
			'oui',
		]),
		[join(fixture.root, 'tests/math.test.ts')],
	)
})

test('reads the question when every path in the reply is context', async () => {
	assert.deepEqual(
		await consentScope(fixture.root, coveringOnly('tests/'), [
			'May I update the tests in tests/?',
			'yes, but leave tests/e2e/ alone',
		]),
		[join(fixture.root, 'tests')],
	)
})
