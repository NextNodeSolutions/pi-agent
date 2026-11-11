import { batchStepFailure } from './action-failure.ts'
import { BrowserConnection } from './browser-connection.ts'
import { BrowserOperations } from './browser-operations.ts'
import { performPageAction } from './page-action-step.ts'
import { capturePage } from './page-capture.ts'
import { observePage } from './page-events.ts'
import { PageInspection } from './page-inspection.ts'
import { navigatePage } from './page-navigation.ts'
import { describePage } from './page-observation.ts'
import { capturePixelFrame } from './page-pixel-frame.ts'
import { BrowserLog, normalizeUrl } from './report.ts'
import { claimSecret } from './secret-handoff.ts'
import {
	fillSharedLogin,
	protectLoginResult,
	redactLoginText,
} from './shared-login-browser.ts'

import type { ImageContent } from '@earendil-works/pi-ai'
import type { AgentToolResult } from '@earendil-works/pi-coding-agent'
import type { BatchStep, Checks } from './action-schema.ts'
import type { ControlsPolicy } from './page-observation.ts'
import type { PixelFrame } from './page-pixel-frame.ts'
import type { PageSpecimen } from './page-specimen.ts'
import type { Config, OpenOptions, ScreenshotOptions } from './schema.ts'

export class FrontendBrowser {
	private connection: BrowserConnection
	private operations = new BrowserOperations(() => this.close())
	private config: Config
	private log: BrowserLog
	private secrets = new Set<string>()
	private sensitiveOrigin: string | undefined

	constructor(config: Config) {
		this.config = config
		this.log = new BrowserLog(config.MAX_CONSOLE)
		this.connection = new BrowserConnection(page =>
			observePage(page, this.log),
		)
	}

	run<Result>(
		operation: () => Promise<Result>,
		signal?: AbortSignal,
		timeoutMs = this.config.NAV_TIMEOUT_MS,
	): Promise<Result> {
		return this.operations.run(operation, signal, timeoutMs)
	}

	redact(text: string): string {
		return redactLoginText(text, this.secrets)
	}

	protectResult<Result>(
		toolResult: AgentToolResult<Result>,
	): AgentToolResult<Result> {
		return protectLoginResult(toolResult, this.secrets)
	}

	private assertSafeScreenshot(): void {
		if (this.sensitiveOrigin)
			throw new Error(
				'Screenshot suppressed after a secret fill in this browser session.',
			)
	}

	/** Claims a handle for the page's current origin; the value is redacted from every output from here on. */
	private claimStepSecret(handle: string): ReturnType<typeof claimSecret> {
		const { origin } = new URL(this.connection.currentPage().url())
		const secret = claimSecret(handle, origin)
		this.secrets.add(secret.value)
		this.sensitiveOrigin = origin
		return secret
	}

	async fillSharedLogin(handle: string): Promise<string> {
		return fillSharedLogin(
			this.connection.currentPage(),
			handle,
			(password, origin) => {
				this.secrets.add(password)
				this.sensitiveOrigin = origin
			},
			this.operations.signal,
		)
	}

	async open(
		options: OpenOptions,
		cwd: string,
		sessionKey?: string,
	): Promise<string> {
		const url = normalizeUrl(options.url, cwd)
		const page = await this.connection.ensurePage(
			this.config,
			this.operations.signal,
			sessionKey,
		)
		this.log.clear()
		await navigatePage(page, url, options.wait_for, {
			close: () => this.close(),
			redact: text => this.redact(text),
		})
		return this.describe('always')
	}

	async actMany(steps: BatchStep[], cwd: string): Promise<string> {
		const page = this.connection.currentPage()
		const urlBefore = page.url()
		const completedIds: string[] = []
		for (const [index, step] of steps.entries()) {
			const resolved =
				step.action === 'goto' && step.url
					? { ...step, url: normalizeUrl(step.url, cwd) }
					: step
			// oxlint-disable-next-line no-await-in-loop -- Each action consumes the previous state.
			await performPageAction(
				{
					page: () => this.connection.currentPage(),
					redact: text => this.redact(text),
					batch: batchStepFailure(steps, index, completedIds),
					secret: step.secret
						? this.claimStepSecret(step.secret)
						: undefined,
				},
				resolved,
			)
			completedIds.push(step.id)
		}
		return `Completed ${steps.length} frontend actions: ${completedIds.join(', ')}\n${await this.describe({ urlBefore })}`
	}

	async describe(policy: ControlsPolicy): Promise<string> {
		return describePage(
			this.connection.currentPage(),
			this.log,
			text => this.redact(text),
			policy,
		)
	}

	async screenshot(options: ScreenshotOptions = {}): Promise<ImageContent> {
		this.assertSafeScreenshot()
		return capturePage(this.connection.currentPage(), this.config, options)
	}
	async capturePixelFrame(
		waitFor: string,
		selector?: string,
	): Promise<PixelFrame> {
		return capturePixelFrame(
			this.connection.currentPage(),
			waitFor,
			selector,
			async () => this.assertSafeScreenshot(),
		)
	}

	withScratchPage: BrowserConnection['withScratchPage'] = work =>
		this.connection.withScratchPage(work)

	private inspection(): PageInspection {
		return new PageInspection(
			this.connection.currentPage(),
			this.config,
			text => this.redact(text),
		)
	}

	async evaluate(expression: string): Promise<string> {
		return this.inspection().evaluate(expression)
	}

	async evaluateChecks(checks: Checks): Promise<string> {
		return this.inspection().evaluateChecks(checks)
	}

	async specimen(waitFor?: string, scope?: string): Promise<PageSpecimen> {
		return this.inspection().specimen(waitFor, scope)
	}

	console(level?: string, max?: number): string {
		this.connection.currentPage()
		return this.log.format(level, max)
	}

	status(): string {
		const mode = this.config.CDP_URL
			? 'shared CDP; persistent profile'
			: 'isolated; per-session persistent profile'
		return `Browser: ${this.connection.isConnected ? 'running' : 'closed'}\nMode: ${mode}\nURL: ${this.connection.currentUrl}\n${this.log.summary()}`
	}

	async configure(config: Config): Promise<void> {
		await this.close()
		this.config = config
		this.log = new BrowserLog(config.MAX_CONSOLE)
	}

	async close(): Promise<void> {
		this.sensitiveOrigin = undefined
		try {
			await this.connection.close()
		} finally {
			this.log.clear()
		}
	}

	async shutdown(): Promise<void> {
		await this.operations.shutdown()
	}
}
