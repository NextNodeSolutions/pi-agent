import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, mock, test } from 'node:test'

import { consentKind, judgeEvidence } from '#lib/test-pace/consent.ts'

const fixture = { root: '' }
const savedKey = process.env.TYPESAFE_API_KEY
const UNREAD = 'tests/unit/'

function jevAnswer(choice: string): Response {
	return Response.json({
		model: 'fake-jev',
		usage: { input_tokens: 1 },
		answers: { decision: { choice, confidence: 0.99, probabilities: {} } },
	})
}

const jevFailingOnUnreadPath: typeof fetch = async (_url, init) => {
	const state: unknown = Reflect.get(
		Object(JSON.parse(String(init?.body))),
		'state',
	)
	const namedPath: unknown = Reflect.get(Object(state), 'namedPath')
	if (typeof namedPath !== 'string') return jevAnswer('existing')
	if (namedPath === UNREAD) throw new TypeError('fetch failed')
	return jevAnswer('covered')
}

before(async () => {
	fixture.root = await realpath(
		await mkdtemp(join(tmpdir(), 'consent-unread-path-')),
	)
	await mkdir(join(fixture.root, 'tests/unit'), { recursive: true })
	await mkdir(join(fixture.root, 'tests/integration'), { recursive: true })
	process.env.TYPESAFE_API_KEY = 'fake-key'
	mock.method(globalThis, 'fetch', jevFailingOnUnreadPath)
})

after(async () => {
	mock.restoreAll()
	if (savedKey) process.env.TYPESAFE_API_KEY = savedKey
	else delete process.env.TYPESAFE_API_KEY
	await rm(fixture.root, { recursive: true, force: true })
})

test('a reply path Jev fails to read grants nothing until it is read again', async () => {
	const { judgment, answered } = await judgeEvidence(fixture.root, {
		id: 'only-unit',
		at: '2026-11-13T10:00:00Z',
		question: 'May I update the tests in tests/?',
		reply: `yes, only ${UNREAD}`,
	})
	assert.equal(answered, false)
	assert.equal(
		consentKind(
			[judgment],
			join(fixture.root, 'tests/integration/order.test.ts'),
		),
		'none',
	)
})
