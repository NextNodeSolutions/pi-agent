/** thread-titles - draws each live thread's title bold in the agent colour when an
 * assistant answer names it, through Pi's public Markdown transformer, so both Pi's
 * own assistant renderer and ui/renderers apply it. thread-list.ts reads the titles
 * from hc off the render path; title-highlight.ts styles prose and skips code.
 * Standalone: `pi --extension <this file>` is enough. */
import { uiTheme } from '#lib/ui/design-system/theme.ts'

import { readThreadTitles } from './thread-list.ts'
import { highlightTitles, titlePattern } from './title-highlight.ts'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const REFRESH_INTERVAL_MS = 10_000
const MISSING_PROGRAM = 'ENOENT'

const styleTitle = (title: string): string =>
	uiTheme.bold(uiTheme.fg('agent', title))

export default function threadTitles(pi: ExtensionAPI): void {
	const knownTitles = new Set<string>()
	let pattern: RegExp | undefined
	let timer: NodeJS.Timeout | undefined
	let isRefreshing = false
	let isHcMissing = false

	const stop = (): void => {
		clearInterval(timer)
		timer = undefined
	}

	const refresh = async (): Promise<void> => {
		if (isRefreshing) return
		isRefreshing = true
		try {
			for (const title of await readThreadTitles()) knownTitles.add(title)
			pattern = titlePattern([...knownTitles])
		} catch (error: unknown) {
			isHcMissing =
				error instanceof Error &&
				Reflect.get(error, 'code') === MISSING_PROGRAM
			if (isHcMissing) stop()
		} finally {
			isRefreshing = false
		}
	}

	pi.registerMarkdownTransformer((markdown, context) =>
		pattern && context.messageType === 'assistant'
			? highlightTitles(markdown, pattern, styleTitle)
			: markdown,
	)
	pi.on('session_start', async (_event, context) => {
		if (!context.hasUI) return
		stop()
		await refresh()
		if (isHcMissing) return
		timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
		timer.unref()
	})
	pi.on('session_shutdown', stop)
}
