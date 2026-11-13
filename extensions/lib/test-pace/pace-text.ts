import { redactSecrets } from '../../../security/secret-redact.ts'

const SECRET_ASSIGNMENT =
	/\b(?:password|token|secret|api[_ -]?key|mot de passe)\s*[:=]\s*\S+/gi

export function redactedPaceText(text: string): string {
	return redactSecrets(text).replace(SECRET_ASSIGNMENT, '[REDACTED]')
}

export function safePaceText(text: string): string {
	return redactedPaceText(
		text
			.replace(
				/<file\b[^>]*>[\s\S]*?(?:<\/file>|$)/gi,
				'[Attached file omitted]',
			)
			.replace(/```[\s\S]*?(?:```|$)/g, '[Code omitted]'),
	)
}
