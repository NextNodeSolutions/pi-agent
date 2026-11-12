import { parseArgs } from 'node:util'

import { machineIdentityName, projectAccess } from './infisical-access.ts'
import { machineToken } from './machine-identity.ts'

const USAGE = 'node ~/.pi/agent/security/project-access.mjs'
const MISSING_EXIT_CODE = 1
const FAILURE_EXIT_CODE = 2

function humanStep(identity, missing) {
	const names = missing.map(project => project.name).join(', ')
	return `${identity} cannot read ${missing.length} project(s): ${names}. One-time human step for each: Infisical, open the project, Access Control, Machine Identities, Add Identity, ${identity}, role Admin. Rerun this command to verify.\n`
}

async function check() {
	const token = await machineToken()
	const [identity, access] = await Promise.all([
		machineIdentityName(token),
		projectAccess(token),
	])
	process.stdout.write(`${JSON.stringify({ identity, ...access })}\n`)
	if (!access.missing.length) return
	process.stderr.write(humanStep(identity, access.missing))
	process.exitCode = MISSING_EXIT_CODE
}

try {
	const { values } = parseArgs({
		options: { help: { type: 'boolean', default: false } },
	})
	if (values.help) process.stdout.write(`${USAGE}\n`)
	else await check()
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? error.message : 'Project access check failed'}. Usage: ${USAGE}\n`,
	)
	process.exitCode = FAILURE_EXIT_CODE
}
