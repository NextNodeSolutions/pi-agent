const SECRET_VARIABLE =
	/TOKEN|SECRET|PASSW|PRIVATE_KEY|API_?KEY|CREDENTIAL|ACCESS_KEY|SESSION_KEY/i
const NON_SECRET_SUFFIX =
	/_(?:FILE|PATH|DIR|URL|NAME|ID|TTL|SECONDS|VALUES|MODE|ENABLED|TYPE)$/i
const MIN_SECRET_LENGTH = 8
const KNOWN_FORMATS: readonly (readonly [string, RegExp])[] = [
	[
		'private-key',
		/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
	],
	['sk-key', /\bsk-[A-Za-z0-9_-]{20,}/g],
	[
		'github-token',
		/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
	],
	['gitlab-token', /\bglpat-[A-Za-z0-9_-]{20,}/g],
	['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
	['aws-access-key-id', /\bAKIA[0-9A-Z]{16}\b/g],
	['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
	['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/g],
	['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
]

function isSecretVariable(name: string, assigned: string): boolean {
	if (!SECRET_VARIABLE.test(name) || NON_SECRET_SUFFIX.test(name))
		return false
	if (assigned.length < MIN_SECRET_LENGTH) return false
	if (/^[/~]/.test(assigned) || /^(?:true|false|\d+)$/.test(assigned))
		return false
	return true
}

export function secretEnvironmentEntries(
	environment: NodeJS.ProcessEnv = process.env,
): [string, string][] {
	return Object.entries(environment)
		.filter(
			(entry): entry is [string, string] => typeof entry[1] === 'string',
		)
		.filter(([name, value]) => isSecretVariable(name, value))
		.toSorted((a, b) => b[1].length - a[1].length)
}

export function redactSecrets(
	text: string,
	environment: NodeJS.ProcessEnv = process.env,
): string {
	let redacted = text
	for (const [name, value] of secretEnvironmentEntries(environment)) {
		if (redacted.includes(value))
			redacted = redacted.split(value).join(`[REDACTED:${name}]`)
	}
	for (const [label, pattern] of KNOWN_FORMATS) {
		redacted = redacted.replace(pattern, `[REDACTED:${label}]`)
	}
	return redacted
}
