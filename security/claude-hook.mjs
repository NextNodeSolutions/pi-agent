import { readFileSync } from 'node:fs'

import { secretAccessRefusal } from './secret-policy.ts'

try {
	const request = JSON.parse(readFileSync(0, 'utf8'))
	if (typeof request.tool_name !== 'string' || !request.tool_input)
		throw new Error('Invalid hook input')
	const { command } = request.tool_input
	const isUnscopedInfisical =
		request.tool_name === 'Bash' &&
		typeof command === 'string' &&
		[
			...command.matchAll(
				/(?:^|[\s;|&(])((?:[\w.~/-]+\/)?infisical)\b/gu,
			),
		].some(
			([, executable = '']) =>
				!executable.endsWith('/.pi/agent/bin/infisical'),
		)
	const reason = isUnscopedInfisical
		? 'Use ~/.pi/agent/bin/infisical so this command authenticates only as the machine identity.'
		: secretAccessRefusal(request.tool_name, request.tool_input)
	if (reason) {
		process.stdout.write(
			JSON.stringify({
				hookSpecificOutput: {
					hookEventName: 'PreToolUse',
					permissionDecision: 'deny',
					permissionDecisionReason: reason,
				},
			}),
		)
	}
} catch {
	process.stderr.write(
		'Secret guard could not validate the call. Tool execution blocked.\n',
	)
	process.exitCode = 2
}
