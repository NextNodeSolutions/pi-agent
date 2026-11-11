import { evaluateChecks } from './page-checks.ts'
import { extractSafeSpecimen } from './page-observation.ts'
import { boundedText } from './report.ts'

import type { Page } from 'playwright-core'
import type { Checks } from './action-schema.ts'
import type { PageSpecimen } from './page-specimen.ts'
import type { Config } from './schema.ts'

const JSON_INDENT = 2

export class PageInspection {
	private page: Page
	private config: Config
	private redact: (text: string) => string

	constructor(page: Page, config: Config, redact: (text: string) => string) {
		this.page = page
		this.config = config
		this.redact = redact
	}

	async evaluate(expression: string): Promise<string> {
		const evaluated: unknown = await this.page.evaluate(expression)
		return boundedText(
			JSON.stringify(evaluated, null, JSON_INDENT) ?? String(evaluated),
			this.config.MAX_EVAL_CHARS,
		)
	}

	async evaluateChecks(checks: Checks): Promise<string> {
		return evaluateChecks(this.page, checks, this.config.MAX_EVAL_CHARS)
	}

	async specimen(waitFor?: string, scope?: string): Promise<PageSpecimen> {
		if (waitFor)
			await this.page.locator(waitFor).waitFor({ state: 'visible' })
		return extractSafeSpecimen(this.page, scope, this.redact)
	}
}
