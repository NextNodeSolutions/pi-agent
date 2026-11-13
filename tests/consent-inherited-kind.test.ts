import assert from 'node:assert/strict'
import { test } from 'node:test'

import { consentKind, sessionConsents } from '#lib/test-pace/consent.ts'

import type { Judgment } from '#lib/test-pace/consent.ts'
import type { Evidence } from '#lib/test-pace/evidence.ts'

const NEW_TESTS: Evidence = {
	id: 'new-tests',
	at: '2026-11-13T10:00:00Z',
	question: 'May I add new tests under tests/?',
	reply: 'ok',
}
const REWRITE: Evidence = {
	id: 'rewrite',
	at: '2026-11-13T10:01:00Z',
	question: 'The legacy snapshot test is stale. May I rewrite it?',
	reply: 'yes',
}

async function judged(evidence: Evidence): Promise<Judgment> {
	const isNewTests = evidence.id === NEW_TESTS.id
	return {
		evidenceId: evidence.id,
		at: evidence.at,
		question: evidence.question,
		reply: evidence.reply,
		verdict: isNewTests ? 'new' : 'existing',
		scope: isNewTests ? ['/repo/tests'] : [],
	}
}

test('a grant naming no path never makes tests allowed as new only editable as existing tests', async () => {
	const consents = await sessionConsents(
		{ evidence: [NEW_TESTS, REWRITE], relays: [] },
		judged,
	)
	assert.equal(consentKind(consents, '/repo/tests/legacy.test.ts'), 'new')
})
