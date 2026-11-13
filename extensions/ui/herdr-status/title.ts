/**
 * Names the session after its first human prompt, once, with the checkpoint
 * model (`summaryModel`), then the session model. The title becomes
 * pi's session name (`pi.setSessionName`), so a reload or resume republishes
 * it without another model request, and `session_info_changed` carries every
 * name (generated or typed with /name) to the publisher. Headless children
 * inherit the terminal's environment and never name it (`ctx.hasUI`).
 * When the model fails, the prompt's first words are published but not
 * stored, so the next session start or turn tries again.
 */
import { uuidv7 } from '@earendil-works/pi-ai'

import { readCheckpointModel } from '#lib/context-budget/model.ts'
import { isHumanPrompt, typedPromptText } from '#lib/human-prompt.ts'

import type { Api, Model, UserMessage } from '@earendil-works/pi-ai'
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from '@earendil-works/pi-coding-agent'

const TITLE_TIMEOUT_MS = 15_000
/** Counts reasoning tokens too on the responses API; a cut title is refused below. */
const TITLE_TOKENS = 2048
const MAX_TITLE_CHARS = 46
const MIN_WORD_CUT = 20
const PROMPT_CHARS = 1400
const FALLBACK_WORDS = 5
const MIN_TITLE_CHARS = 2
const SYSTEM_PROMPT = 'You write terse session titles.'
const INSTRUCTION =
	'Name this coding agent session, based only on its first user message. Reply with ONLY the title: max 4 words, no quotes.'
/** `hc send` relays text as `<hc from="t1">text</hc>`; the title reads the text. */
const HC_WRAPPER = /^<hc\b[^>]*>([\s\S]*?)<\/hc>\s*$/u

export type PublishTitle = (title: string) => Promise<void>

function normalized(text: string): string {
	const typed = typedPromptText(text).trim()
	const relayed = HC_WRAPPER.exec(typed)?.[1] ?? typed
	return relayed.replace(/\s+/gu, ' ').trim()
}

function userText(content: UserMessage['content']): string {
	if (typeof content === 'string') return content
	return content
		.flatMap(part => (part.type === 'text' ? [part.text] : []))
		.join(' ')
}

export function firstHumanPrompt(
	entries: readonly SessionEntry[],
): string | undefined {
	for (const entry of entries) {
		if (entry.type !== 'message' || entry.message.role !== 'user') continue
		const text = normalized(userText(entry.message.content))
		if (text) return text
	}
	return undefined
}

export function tidyTitle(raw: string): string | undefined {
	const line = raw.replace(/["'`]/gu, '').split(/\r?\n/u)[0] ?? ''
	const words = line.replace(/\s+/gu, ' ').trim()
	if (words.length < MIN_TITLE_CHARS) return undefined
	if (words.length <= MAX_TITLE_CHARS) return words
	const cut = words.slice(0, MAX_TITLE_CHARS)
	const space = cut.lastIndexOf(' ')
	return cut.slice(0, space > MIN_WORD_CUT ? space : MAX_TITLE_CHARS).trim()
}

export function fallbackTitle(prompt: string): string {
	return prompt.split(' ').slice(0, FALLBACK_WORDS).join(' ')
}

function checkpointModel(ctx: ExtensionContext): Model<Api> | undefined {
	const reference = readCheckpointModel()
	if (!reference) return undefined
	const slash = reference.indexOf('/')
	return ctx.modelRegistry.find(
		reference.slice(0, slash),
		reference.slice(slash + 1),
	)
}

function titleModels(ctx: ExtensionContext): Model<Api>[] {
	const fast = checkpointModel(ctx)
	const usableFast =
		fast && ctx.modelRegistry.hasConfiguredAuth(fast) ? [fast] : []
	const session = ctx.model ? [ctx.model] : []
	return [...usableFast, ...session].filter(
		(model, index, all) =>
			all.findIndex(
				other =>
					other.provider === model.provider && other.id === model.id,
			) === index,
	)
}

async function generateTitle(
	ctx: ExtensionContext,
	prompt: string,
	models: readonly Model<Api>[] = titleModels(ctx),
): Promise<string | undefined> {
	const [model, ...rest] = models
	if (!model) return undefined
	return (
		(await requestTitle(ctx, model, prompt)) ??
		generateTitle(ctx, prompt, rest)
	)
}

async function requestTitle(
	ctx: ExtensionContext,
	model: Model<Api>,
	prompt: string,
): Promise<string | undefined> {
	try {
		const response = await ctx.modelRegistry.complete(
			model,
			{
				systemPrompt: SYSTEM_PROMPT,
				messages: [
					{
						role: 'user',
						content: [
							{
								type: 'text',
								text: `${INSTRUCTION}\n\n${prompt.slice(0, PROMPT_CHARS)}`,
							},
						],
						timestamp: Date.now(),
					},
				],
			},
			{
				maxTokens: TITLE_TOKENS,
				reasoning: 'minimal',
				signal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
				cacheRetention: 'none',
				sessionId: uuidv7(),
			},
		)
		if (response.stopReason !== 'stop') return undefined
		return tidyTitle(
			response.content
				.flatMap(part => (part.type === 'text' ? [part.text] : []))
				.join(' '),
		)
	} catch {
		return undefined
	}
}

export function registerSessionTitle(
	pi: ExtensionAPI,
	publish: PublishTitle,
): void {
	let pendingPrompt: string | undefined
	let naming: string | undefined

	const name = async (
		ctx: ExtensionContext,
		prompt: string,
	): Promise<void> => {
		const session = ctx.sessionManager.getSessionId()
		if (naming === session) return
		naming = session
		try {
			const title = await generateTitle(ctx, prompt)
			if (ctx.sessionManager.getSessionId() !== session) return
			if (title) pi.setSessionName(title)
			else await publish(fallbackTitle(prompt))
		} finally {
			if (naming === session) naming = undefined
		}
	}

	const settle = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI) return
		const current = ctx.sessionManager.getSessionName()
		if (current) {
			void publish(current)
			return
		}
		const prompt =
			firstHumanPrompt(ctx.sessionManager.getBranch()) ?? pendingPrompt
		if (prompt) void name(ctx, prompt)
	}

	pi.on('session_start', (_event, ctx) => {
		pendingPrompt = undefined
		if (ctx.hasUI && !ctx.sessionManager.getSessionName()) void publish('')
		settle(ctx)
	})
	pi.on('input', event => {
		if (isHumanPrompt(event)) pendingPrompt = normalized(event.text)
	})
	pi.on('before_agent_start', (_event, ctx) => {
		if (!ctx.sessionManager.getSessionName()) settle(ctx)
		pendingPrompt = undefined
	})
	pi.on('session_info_changed', (event, ctx) => {
		if (ctx.hasUI) void publish(event.name ?? '')
	})
}
