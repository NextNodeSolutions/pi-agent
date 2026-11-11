import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { runtimeFor } from '#lib/runtime/runtime.ts'

const REWRITE_COMMAND =
	'"$HOME/.pi/agent/skills/tailnet-links/scripts/tailnet-link" rewrite'
const REWRITE_TIMEOUT_MS = 15_000
const MAX_PAYLOAD_CHARACTERS = 200_000
const ReplySchema = Type.Object({
	texts: Type.Array(Type.String()),
	notes: Type.Array(Type.String()),
})

export type Rewrite =
	| {
			readonly kind: 'rewritten'
			readonly texts: readonly string[]
			readonly notes: readonly string[]
	  }
	| { readonly kind: 'failed'; readonly reason: string }

function parseReply(output: string, expectedCount: number): Rewrite {
	const failed: Rewrite = { kind: 'failed', reason: output.trim() }
	const lastLine = output.trim().split('\n').at(-1)
	if (!lastLine?.startsWith('{')) return failed
	const reply: unknown = JSON.parse(lastLine)
	if (!Value.Check(ReplySchema, reply)) return failed
	if (reply.texts.length !== expectedCount) return failed
	return { kind: 'rewritten', texts: reply.texts, notes: reply.notes }
}

/** Runs where the project lives: a Boat's paths and ports exist only there. */
export async function rewriteTexts(
	texts: readonly string[],
	cwd: string,
): Promise<Rewrite> {
	const payload = Buffer.from(JSON.stringify(texts)).toString('base64')
	if (payload.length > MAX_PAYLOAD_CHARACTERS) {
		return { kind: 'rewritten', texts, notes: [] }
	}
	const chunks: Buffer[] = []
	try {
		await runtimeFor(cwd).exec(`${REWRITE_COMMAND} ${payload}`, cwd, {
			onData: chunk => chunks.push(chunk),
			signal: AbortSignal.timeout(REWRITE_TIMEOUT_MS),
		})
		return parseReply(Buffer.concat(chunks).toString('utf8'), texts.length)
	} catch (error: unknown) {
		const reason = error instanceof Error ? error.message : String(error)
		return { kind: 'failed', reason }
	}
}
