import { showHumanDialog } from '#lib/ui/human-dialog.ts'

import { runQuestionnaire } from './questionnaire-component.ts'

import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { QuestionnaireCaptures } from './questionnaire-captures.ts'
import type {
	AskResult,
	QuestionnaireInitialState,
} from './questionnaire-model.ts'
import type { normalizeQuestions } from './questionnaire-normalization.ts'

export function showQuestionnaire(
	context: ExtensionContext,
	signal: AbortSignal | undefined,
	dialog: {
		questions: ReturnType<typeof normalizeQuestions>
		resumeState: QuestionnaireInitialState | undefined
		captures: QuestionnaireCaptures
	},
): Promise<AskResult> {
	return runQuestionnaire(
		factory =>
			showHumanDialog<AskResult>(context, signal, {
				build: factory,
				cancelled: () => ({
					questions: dialog.questions,
					answers: [],
					cancelled: true,
				}),
				waitingMessage: 'Waiting for an answer',
			}),
		dialog.questions,
		dialog.resumeState,
		dialog.captures,
	)
}
