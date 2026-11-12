import { call, HTTP_OK } from './infisical-rest.ts'
import { machineIdentityId, vaultApi } from './machine-identity.ts'

const PAGE_SIZE = 100
const SECRET_MANAGER = 'secret-manager'

export interface ProjectSummary {
	id: string
	name: string
}

export interface ProjectAccess {
	readable: ProjectSummary[]
	missing: ProjectSummary[]
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

function secretManagers(listing: unknown): ProjectSummary[] {
	if (!Array.isArray(listing))
		throw new Error('Unexpected Infisical project list')
	return listing
		.filter((project: unknown) => text(project, 'type') === SECRET_MANAGER)
		.map((project: unknown) => ({
			id: text(project, 'id'),
			name: text(project, 'name'),
		}))
}

async function organizationProjects(
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
	const projects = secretManagers(page.projects)
	const next = offset + PAGE_SIZE
	if (next >= count) return projects
	return [...projects, ...(await organizationProjects(token, next))]
}

export async function projectAccess(token: string): Promise<ProjectAccess> {
	const [organization, member] = await Promise.all([
		organizationProjects(token),
		read(token, `/v1/projects?type=${SECRET_MANAGER}`),
	])
	const memberIds = new Set(
		secretManagers(member.projects).map(project => project.id),
	)
	return {
		readable: organization.filter(project => memberIds.has(project.id)),
		missing: organization.filter(project => !memberIds.has(project.id)),
	}
}

export async function machineIdentityName(token: string): Promise<string> {
	const identityId = encodeURIComponent(machineIdentityId())
	const { identity } = await read(token, `/v1/identities/${identityId}`)
	return text(field(identity, 'identity'), 'name')
}
