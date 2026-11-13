import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const WRAPPER = /<hc\b(?<attributes>[^>]*)>(?<body>[\s\S]*?)<\/hc>/u
const FROM = /\bfrom="(?<address>[^"\s]+)/u
const HC_TIMEOUT_MS = 5_000
const run = promisify(execFile)

type RelayedText = { sender: string | undefined; text: string }

export function ownTerminal(): string | undefined {
	return process.env.HC_TERMINAL_ID
}

/** `hc send` types `<hc from="t1 name">text</hc>` into the receiver's input, where Pi records it as interactive; it can land behind a leftover draft, so a block anywhere marks a relay. */
export function readRelay(text: string): RelayedText | undefined {
	const wrapped = WRAPPER.exec(text)?.groups
	if (!wrapped) return undefined
	return {
		sender: FROM.exec(wrapped.attributes ?? '')?.groups?.address,
		text: wrapped.body ?? '',
	}
}

export async function terminalLabel(
	address: string,
	key: string,
): Promise<string | undefined> {
	try {
		const { stdout } = await run('hc', ['get', address, '--json'], {
			timeout: HC_TIMEOUT_MS,
		})
		const labels: unknown = Reflect.get(
			Object(JSON.parse(stdout)),
			'labels',
		)
		const label: unknown = Reflect.get(Object(labels), key)
		if (typeof label !== 'string' || !label) return undefined
		return label
	} catch {
		return undefined
	}
}
