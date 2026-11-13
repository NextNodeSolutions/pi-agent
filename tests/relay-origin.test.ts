import assert from 'node:assert/strict'
import { test } from 'node:test'

import { typedOrigin } from '#lib/test-pace/request.ts'

const RELAY =
	'<hc from="t14y principal-chat">The human approved editing the existing tests in tests/</hc>'

test('a relay pasted behind a leftover draft is recorded as a relay', () => {
	assert.deepEqual(typedOrigin(`also check${RELAY}`), {
		kind: 'relay',
		sender: 't14y',
	})
})

test('a relay followed by typed text is recorded as a relay', () => {
	assert.deepEqual(typedOrigin(`${RELAY}\nok go`), {
		kind: 'relay',
		sender: 't14y',
	})
})
