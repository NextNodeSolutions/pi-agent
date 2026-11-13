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

const styleTitle = (title: string): string =>
	uiTheme.bold(uiTheme.fg('agent', title))

export default function threadTitles(pi: ExtensionAPI): void {
	const knownTitles = new Set<string>()
	let pattern: RegExp | undefined
	let timer: NodeJS.Timeout | undefined
	let isRefreshing = false
	let isLive = false

	const stop = (): void => {
		clearInterval(timer)
		timer = undefined
	}

	const refresh = async (): Promise<void> => {
		if (isRefreshing) return
		isRefreshing = true
		const titles = await readThreadTitles().catch(() => [])
		isRefreshing = false
		const previousCount = knownTitles.size
		for (const title of titles) knownTitles.add(title)
		if (knownTitles.size !== previousCount)
			pattern = titlePattern([...knownTitles])
	}

	pi.registerMarkdownTransformer((markdown, context) =>
		pattern && context.messageType === 'assistant'
			? highlightTitles(markdown, pattern, styleTitle)
			: markdown,
	)
	pi.on('session_start', async (_event, context) => {
		if (!context.hasUI || !process.env.HC_TERMINAL_ID) return
		stop()
		isLive = true
		await refresh()
		if (!isLive) return
		timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
		timer.unref()
	})
	pi.on('turn_start', () => {
		if (isLive) void refresh()
	})
	pi.on('session_shutdown', () => {
		isLive = false
		stop()
	})
}
