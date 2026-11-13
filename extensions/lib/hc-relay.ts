import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

/** Pi publishes its session file under this terminal label, so a relay's receiver can read the sender's records. */
export const SESSION_LABEL = 'pi.session'

const WRAPPER = /^\s*<hc\b(?<attributes>[^>]*)>(?<body>[\s\S]*?)<\/hc>\s*$/u
const FROM = /\bfrom="(?<address>[^"\s]+)/u
const HC_TIMEOUT_MS = 5_000
const run = promisify(execFile)

export type RelayedText = { sender: string | undefined; text: string }

/** `hc send` types `<hc from="t1 name">text</hc>` into the receiver's input, where Pi records it as interactive. */
export function readRelay(text: string): RelayedText | undefined {
	const wrapped = WRAPPER.exec(text)?.groups
	if (!wrapped) return undefined
	return {
		sender: FROM.exec(wrapped.attributes ?? '')?.groups?.address,
		text: wrapped.body ?? '',
	}
}

export async function senderSessionFile(
	sender: string,
): Promise<string | undefined> {
	try {
		const { stdout } = await run('hc', ['get', sender, '--json'], {
			timeout: HC_TIMEOUT_MS,
		})
		const labels: unknown = Reflect.get(
			Object(JSON.parse(stdout)),
			'labels',
		)
		const file: unknown = Reflect.get(Object(labels), SESSION_LABEL)
		if (typeof file !== 'string' || !file) return undefined
		return file
	} catch {
		return undefined
	}
}
