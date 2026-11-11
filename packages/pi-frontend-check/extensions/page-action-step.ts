import { buildActFailure } from './action-failure.ts'
import { actOnPage, actWithPopup, diagnoseFailure } from './page-actions.ts'
import { visibleControls } from './page-controls.ts'

import type { Page } from 'playwright-core'
import type {
	ActionFailure,
	ActFailurePhase,
	BatchFailure,
} from './action-failure.ts'
import type { BatchStep } from './action-schema.ts'
import type { BoundSecret } from './secret-handoff.ts'

type StepContext = {
	page: () => Page
	redact: (text: string) => string
	batch: BatchFailure
	secret?: BoundSecret | undefined
}

async function failedStep(
	context: StepContext,
	options: BatchStep,
	phase: ActFailurePhase,
	error: unknown,
): Promise<ActionFailure> {
	const diagnosis = await diagnoseFailure(context.page, options, phase)
	if (!diagnosis) throw error
	const failure = buildActFailure({
		options,
		phase,
		error,
		diagnosis,
		batch: context.batch,
		redact: context.redact,
	})
	failure.message += `\n${await visibleControls(context.page(), context.redact)}`
	return failure
}

export async function performPageAction(
	context: StepContext,
	options: BatchStep,
): Promise<void> {
	try {
		const page = context.page()
		if (options.popup) await actWithPopup(page, options)
		else await actOnPage(page, options, context.secret)
	} catch (error) {
		throw await failedStep(context, options, 'action', error)
	}
	try {
		if (options.wait_for)
			await context
				.page()
				.locator(options.wait_for)
				.waitFor({ state: 'visible' })
	} catch (error) {
		throw await failedStep(context, options, 'readiness', error)
	}
}
