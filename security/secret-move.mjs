import { parseArgs } from 'node:util'

import {
	API,
	call,
	HTTP_OK,
	names,
	query,
	sessionToken,
} from './infisical-rest.ts'
import {
	parseLocation,
	SECRET_NAME_PATTERN,
	SECRET_PATH_PATTERN,
} from './infisical-target.ts'

const USAGE =
	'node ~/.pi/agent/security/secret-move.mjs --name NAME --from PROJECT_ID/ENV --to PROJECT_ID/ENV [--path /] [--keep] [--replace]'

function readOptions() {
	const { values } = parseArgs({
		options: {
			name: { type: 'string' },
			from: { type: 'string' },
			to: { type: 'string' },
			path: { type: 'string', default: '/' },
			keep: { type: 'boolean', default: false },
			replace: { type: 'boolean', default: false },
			help: { type: 'boolean', default: false },
		},
	})
	if (values.help) return values
	if (!values.name || !new RegExp(SECRET_NAME_PATTERN, 'u').test(values.name))
		throw new Error('Invalid secret name')
	if (!new RegExp(SECRET_PATH_PATTERN, 'u').test(values.path))
		throw new Error('Invalid secret path')
	return {
		...values,
		from: parseLocation(values.from),
		to: parseLocation(values.to),
	}
}

async function move(options) {
	const token = sessionToken()
	const { name, from, to, path } = options
	const read = await call(token, 'GET', `${API}/${name}?${query(from, path)}`)
	const secretValue = read.json.secret?.secretValue
	if (read.status !== HTTP_OK || typeof secretValue !== 'string')
		throw new Error(`${name} is not in the source (HTTP ${read.status})`)
	const existing = await names(token, to, path)
	if (existing.includes(name) && !options.replace)
		throw new Error(
			`${name} already exists in the target, pass --replace to overwrite it`,
		)
	const body = { ...to, secretPath: path, secretValue }
	const write = await call(
		token,
		existing.includes(name) ? 'PATCH' : 'POST',
		`${API}/${name}`,
		body,
	)
	if (write.status !== HTTP_OK)
		throw new Error(`Write to the target failed: HTTP ${write.status}`)
	if (!(await names(token, to, path)).includes(name))
		throw new Error(`${name} is not in the target after the write`)
	process.stdout.write(
		`${name}: written to ${to.workspaceId}/${to.environment}${path}\n`,
	)
	if (options.keep) return
	const remove = await call(token, 'DELETE', `${API}/${name}`, {
		...from,
		secretPath: path,
	})
	if (remove.status !== HTTP_OK)
		throw new Error(
			`Delete from the source failed: HTTP ${remove.status}; the target holds the value`,
		)
	if ((await names(token, from, path)).includes(name))
		throw new Error(`${name} is still in the source after the delete`)
	process.stdout.write(
		`${name}: removed from ${from.workspaceId}/${from.environment}${path}\n`,
	)
}

try {
	const options = readOptions()
	if (options.help) process.stdout.write(`${USAGE}\n`)
	else await move(options)
} catch (error) {
	process.stderr.write(
		`${error.message}. No value was printed. Usage: ${USAGE}\n`,
	)
	process.exitCode = 1
}
