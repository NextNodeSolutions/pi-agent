import { call, HTTP_OK } from './infisical-rest.ts'
import { machineIdentityId, vaultApi } from './machine-identity.ts'

const PAGE_SIZE = 100
const SECRET_MANAGER = 'secret-manager'
const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404

export type ProjectSummary = {
	id: string
	name: string
	type: string
}

export class ProjectAccessRefused extends Error {
	override name = 'ProjectAccessRefused'
}

function field(record: unknown, key: string): unknown {
	if (typeof record !== 'object' || record === null) return undefined
	return Reflect.get(record, key)
}

function text(record: unknown, key: string): string {
	const metadataText = field(record, key)
	if (typeof metadataText !== 'string')
		throw new Error(`Infisical metadata has no ${key}`)
	return metadataText
}

async function read(
	token: string,
	path: string,
): Promise<Record<string, unknown>> {
	const { status, json } = await call(token, 'GET', `${vaultApi()}${path}`)
	if (status !== HTTP_OK)
		throw new Error(`Infisical GET ${path}: HTTP ${status}`)
	return json
}

function projects(listing: unknown): ProjectSummary[] {
	if (!Array.isArray(listing))
		throw new Error('Unexpected Infisical project list')
	return listing.map((project: unknown) => ({
		id: text(project, 'id'),
		name: text(project, 'name'),
		type: text(project, 'type'),
	}))
}

export async function organizationProjects(
	token: string,
	offset = 0,
): Promise<ProjectSummary[]> {
	const page = await read(
		token,
		`/v1/organization-admin/projects?limit=${PAGE_SIZE}&offset=${offset}`,
	)
	const { count } = page
	if (typeof count !== 'number')
		throw new Error('Unexpected Infisical project count')
	const listed = projects(page.projects)
	const next = offset + PAGE_SIZE
	if (next >= count) return listed
	return [...listed, ...(await organizationProjects(token, next))]
}

async function machineIdentityName(token: string): Promise<string> {
	const identityId = encodeURIComponent(machineIdentityId())
	const { identity } = await read(token, `/v1/identities/${identityId}`)
	return text(field(identity, 'identity'), 'name')
}

async function refusalMessage(
	token: string,
	projectId: string,
): Promise<string> {
	const [identity, organization, member] = await Promise.all([
		machineIdentityName(token),
		organizationProjects(token),
		read(token, `/v1/projects?type=${SECRET_MANAGER}`),
	])
	const target = organization.find(project => project.id === projectId)
	if (!target)
		throw new Error(
			'The refused project is absent from the organization project list',
		)
	const memberIds = new Set(
		projects(member.projects).map(project => project.id),
	)
	const others = organization
		.filter(
			project =>
				project.id !== projectId &&
				project.type === SECRET_MANAGER &&
				!memberIds.has(project.id),
		)
		.map(project => project.name)
	const alsoMissing = others.length
		? ` It cannot read ${others.join(', ')} either.`
		: ''
	return `${identity} is not a member of the Infisical project ${target.name}, so this command stopped before using it.${alsoMissing} One-time human step for each project: Infisical, open the project, Access Control, Machine Identities, Add Identity, ${identity}, role Admin. Rerun this command to verify`
}

export async function requireProjectAccess(
	token: string,
	projectId: string,
): Promise<void> {
	const path = `/v1/projects/${encodeURIComponent(projectId)}`
	const { status } = await call(token, 'GET', `${vaultApi()}${path}`)
	if (status === HTTP_OK) return
	if (status === HTTP_FORBIDDEN)
		throw new ProjectAccessRefused(await refusalMessage(token, projectId))
	if (status === HTTP_NOT_FOUND)
		throw new ProjectAccessRefused(
			`No Infisical project has ID ${projectId} (HTTP ${status}). The committed project link, INFISICAL_PROJECT_ID or --projectId is wrong: a broken link, not missing access. Correct it and rerun this command`,
		)
	throw new Error(`Infisical GET ${path}: HTTP ${status}`)
}
