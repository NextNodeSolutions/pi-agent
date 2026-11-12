import { parseArgs } from 'node:util'

import {
	organizationProjects,
	requireProjectAccess,
} from './infisical-access.ts'
import { call, HTTP_OK } from './infisical-rest.ts'
import { ENVIRONMENT_PATTERN, PROJECT_ID_PATTERN } from './infisical-target.ts'
import { machineToken, vaultApi } from './machine-identity.ts'

const USAGE =
	'node ~/.pi/agent/security/project-provision.mjs --name NAME --owner EMAIL --env SLUG [--env SLUG] [--check]'
const PROJECTS = '/v1/projects'
const ADMIN_ROLE = 'admin'

function options() {
	const { values } = parseArgs({
		options: {
			name: { type: 'string' },
			owner: { type: 'string' },
			env: { type: 'string', multiple: true },
			check: { type: 'boolean', default: false },
			help: { type: 'boolean', default: false },
		},
	})
	if (values.help) return values
	if (!values.name || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(values.name))
		throw new Error('Expected the exact repository name')
	if (!values.owner || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(values.owner))
		throw new Error('Expected the verified human organization member email')
	if (
		!values.env?.length ||
		values.env.some(
			slug => !new RegExp(ENVIRONMENT_PATTERN, 'u').test(slug),
		)
	)
		throw new Error('At least one valid environment slug is required')
	return { ...values, env: [...new Set(values.env)] }
}

function record(metadata) {
	if (
		typeof metadata !== 'object' ||
		metadata === null ||
		Array.isArray(metadata)
	)
		throw new Error('Unexpected Infisical metadata format')
	return metadata
}

function array(entries) {
	if (!Array.isArray(entries))
		throw new Error('Unexpected Infisical metadata list')
	return entries.map(record)
}

async function request(token, method, path, body) {
	const response = await call(token, method, `${vaultApi()}${path}`, body)
	if (response.status !== HTTP_OK)
		throw new Error(
			`Project provisioning ${method} ${path}: HTTP ${response.status}`,
		)
	return response.json
}

function projectRecord(metadata) {
	const project = record(metadata)
	if (
		typeof project.id !== 'string' ||
		!new RegExp(PROJECT_ID_PATTERN, 'u').test(project.id)
	)
		throw new Error('Infisical returned no valid project ID')
	array(project.environments)
	return project
}

async function selectProject(token, settings) {
	const listing = await request(
		token,
		'GET',
		`${PROJECTS}?type=secret-manager`,
	)
	const matches = array(listing.projects).filter(
		project => project.name === settings.name,
	)
	if (matches.length > 1)
		throw new Error(
			'Multiple projects have this name. Resolve the ambiguity before provisioning',
		)
	const [existing] = matches
	if (existing) return projectRecord(existing)
	const hidden = (await organizationProjects(token)).find(
		project =>
			project.type === 'secret-manager' && project.name === settings.name,
	)
	if (hidden) {
		await requireProjectAccess(token, hidden.id)
		return projectRecord(
			(await request(token, 'GET', `${PROJECTS}/${hidden.id}`)).project,
		)
	}
	if (settings.check)
		throw new Error('Project is absent; check mode performs no writes')
	const created = await request(token, 'POST', PROJECTS, {
		projectName: settings.name,
		slug: settings.name.toLowerCase(),
		type: 'secret-manager',
		shouldCreateDefaultEnvs: false,
	})
	const project = projectRecord(created.project)
	process.stderr.write(
		`Created project ${project.id}. Rerun the same command to finish if a later step fails.\n`,
	)
	return project
}

function hasHumanAdmin(memberships, email) {
	return array(memberships).some(membership => {
		const user = record(membership.user)
		return (
			user.email === email &&
			array(membership.roles).some(
				role => role.role === ADMIN_ROLE && role.isTemporary === false,
			)
		)
	})
}

async function ensureOwner(token, projectId, settings) {
	const path = `${PROJECTS}/${projectId}/memberships`
	const current = await request(token, 'GET', path)
	if (hasHumanAdmin(current.memberships, settings.owner)) return
	if (settings.check)
		throw new Error('The human has no permanent project admin membership')
	if (
		array(current.memberships).some(
			membership => record(membership.user).email === settings.owner,
		)
	)
		throw new Error(
			'The human is already a project member without admin access. Existing roles were preserved',
		)
	await request(token, 'POST', path, {
		emails: [settings.owner],
		roleSlugs: [ADMIN_ROLE],
	})
	const verified = await request(token, 'GET', path)
	if (!hasHumanAdmin(verified.memberships, settings.owner))
		throw new Error(
			'Human admin access was not verified; provisioning is incomplete',
		)
}

async function ensureEnvironments(token, project, settings) {
	const existing = array(project.environments).map(
		environment => environment.slug,
	)
	const extra = existing.filter(slug => !settings.env.includes(slug))
	if (extra.length)
		throw new Error(
			`Unexpected environments: ${extra.join(', ')}. Nothing was deleted`,
		)
	const missing = settings.env.filter(slug => !existing.includes(slug))
	if (settings.check && missing.length)
		throw new Error(`Missing environments: ${missing.join(', ')}`)
	await Promise.all(
		missing.map(slug =>
			request(token, 'POST', `${PROJECTS}/${project.id}/environments`, {
				name: slug,
				slug,
			}),
		),
	)
	const verified = projectRecord(
		(await request(token, 'GET', `${PROJECTS}/${project.id}`)).project,
	)
	const actual = array(verified.environments).map(
		environment => environment.slug,
	)
	if (
		actual.length !== settings.env.length ||
		settings.env.some(slug => !actual.includes(slug))
	)
		throw new Error(
			'Environment verification failed; provisioning is incomplete',
		)
}

async function provision(settings) {
	const token = await machineToken()
	const project = await selectProject(token, settings)
	await ensureOwner(token, project.id, settings)
	await ensureEnvironments(token, project, settings)
	process.stdout.write(
		`${JSON.stringify({
			projectId: project.id,
			name: settings.name,
			environments: settings.env,
			humanAdmin: settings.owner,
			verified: true,
		})}\n`,
	)
}

try {
	const settings = options()
	if (settings.help) process.stdout.write(`${USAGE}\n`)
	else await provision(settings)
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? error.message : 'Project provisioning failed'}. No credential output was released.\n`,
	)
	process.exitCode = 1
}
