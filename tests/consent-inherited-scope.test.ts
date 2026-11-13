import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
	consentKind,
	consentsAllowing,
	sessionConsents,
} from '#lib/test-pace/consent.ts'

import type { Judgment } from '#lib/test-pace/consent.ts'
import type { Evidence } from '#lib/test-pace/evidence.ts'
import type { ConsentVerdict } from '#lib/test-pace/permission.ts'

const TESTS = '/repo/tests'
const MOVE_GRANT: Evidence = {
	id: 'grant',
	at: '2026-11-13T10:00:00Z',
	question: 'May I move the existing tests in tests/ when code moves?',
	reply: 'yes, mechanical moves only',
}
const STOP: Evidence = {
	id: 'stop',
	at: '2026-11-13T10:01:00Z',
	question: 'Shall I continue?',
	reply: 'stop editing tests',
}
const GO: Evidence = {
	id: 'go',
	at: '2026-11-13T10:02:00Z',
	question:
		'Understood. Existing tests may move with the code. What change should I apply?',
	reply: 'Carry out TASK-MOVE.md exactly as written, now.',
}

function judged(
	verdicts: Record<string, ConsentVerdict>,
	scopes: Record<string, string[]>,
) {
	return async (evidence: Evidence): Promise<Judgment> => ({
		evidenceId: evidence.id,
		at: evidence.at,
		question: evidence.question,
		reply: evidence.reply,
		verdict: verdicts[evidence.id] ?? 'none',
		scope: scopes[evidence.id] ?? [],
	})
}

test('a grant naming no path covers what the grants before it cover, not the rest of the repository', async () => {
	const consents = await sessionConsents(
		{ evidence: [MOVE_GRANT, GO], relays: [] },
		judged({ grant: 'existing', go: 'existing' }, { grant: [TESTS] }),
	)
	assert.deepEqual(
		consentsAllowing(consents, `${TESTS}/math.test.ts`, 'existing').map(
			consent => consent.evidenceId,
		),
		['grant', 'go'],
	)
	assert.equal(consentKind(consents, '/repo/src/math.test.ts'), 'none')
})

test('a grant naming no path covers nothing when the grant before it was withdrawn', async () => {
	const consents = await sessionConsents(
		{ evidence: [MOVE_GRANT, STOP, GO], relays: [] },
		judged(
			{ grant: 'existing', stop: 'withdraw', go: 'existing' },
			{ grant: [TESTS] },
		),
	)
	assert.equal(consentKind(consents, `${TESTS}/math.test.ts`), 'none')
})
