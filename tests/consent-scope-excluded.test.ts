import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, mock, test } from 'node:test'

import { consentKind, judgeEvidence } from '#lib/test-pace/consent.ts'

const fixture = { root: '' }
const savedKey = process.env.TYPESAFE_API_KEY

function jevAnswer(choice: string): Response {
	return Response.json({
		model: 'fake-jev',
		usage: { input_tokens: 1 },
		answers: { decision: { choice, confidence: 0.99, probabilities: {} } },
	})
}

function fakeJev(covered: readonly string[]): typeof fetch {
	return async (_url, init) => {
		const state: unknown = Reflect.get(
			Object(JSON.parse(String(init?.body))),
			'state',
		)
		const namedPath: unknown = Reflect.get(Object(state), 'namedPath')
		if (typeof namedPath !== 'string') return jevAnswer('existing')
		return jevAnswer(covered.includes(namedPath) ? 'covered' : 'context')
	}
}

before(async () => {
	fixture.root = await realpath(
		await mkdtemp(join(tmpdir(), 'consent-scope-excluded-')),
	)
	await mkdir(join(fixture.root, 'tests/e2e'), { recursive: true })
	await mkdir(join(fixture.root, 'tests/unit'), { recursive: true })
	process.env.TYPESAFE_API_KEY = 'fake-key'
	mock.method(globalThis, 'fetch', fakeJev(['tests/']))
})

after(async () => {
	mock.restoreAll()
	if (savedKey) process.env.TYPESAFE_API_KEY = savedKey
	else delete process.env.TYPESAFE_API_KEY
	await rm(fixture.root, { recursive: true, force: true })
})

test('a test directory the person leaves out stays refused while the rest of the grant holds', async () => {
	const { judgment } = await judgeEvidence(fixture.root, {
		id: 'leave-e2e',
		at: '2026-11-13T10:00:00Z',
		question: 'May I update the tests in tests/?',
		reply: 'yes, but leave tests/e2e/ alone',
	})
	assert.equal(
		consentKind([judgment], join(fixture.root, 'tests/e2e/login.test.ts')),
		'none',
	)
	assert.equal(
		consentKind([judgment], join(fixture.root, 'tests/unit/cart.test.ts')),
		'existing',
	)
})
