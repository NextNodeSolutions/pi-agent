import type { Locator } from 'playwright-core'
import type { BoundSecret } from './secret-handoff.ts'

type FillOutcome = 'filled' | 'origin' | 'not-input'

/** Runs in the page: the origin is re-checked at the instant the value lands. */
function setBoundValue(
	element: Element,
	bound: { boundOrigin: string; value: string },
): FillOutcome {
	if (location.origin !== bound.boundOrigin || window.top !== window)
		return 'origin'
	if (
		!(element instanceof HTMLInputElement) &&
		!(element instanceof HTMLTextAreaElement)
	)
		return 'not-input'
	const setter = Object.getOwnPropertyDescriptor(
		Object.getPrototypeOf(element),
		'value',
	)?.set
	if (!setter) return 'not-input'
	element.focus()
	setter.call(element, bound.value)
	element.dispatchEvent(new Event('input', { bubbles: true }))
	element.dispatchEvent(new Event('change', { bubbles: true }))
	return 'filled'
}

const FILL_FAILURES: Record<Exclude<FillOutcome, 'filled'>, string> = {
	origin: 'Page origin changed before the fill; nothing was filled.',
	'not-input': 'Secret target is not a text input; nothing was filled.',
}

export async function fillBoundSecret(
	locator: Locator,
	secret: BoundSecret,
): Promise<void> {
	await locator.waitFor({ state: 'visible' })
	let outcome: FillOutcome
	try {
		outcome = await locator.evaluate(setBoundValue, {
			boundOrigin: secret.origin,
			value: secret.value,
		})
	} catch {
		// Playwright errors can quote evaluated arguments.
		throw new Error('Secret fill failed; nothing sensitive was returned.')
	}
	if (outcome !== 'filled') throw new Error(FILL_FAILURES[outcome])
}
