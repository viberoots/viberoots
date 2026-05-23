import type { InfisicalApi } from "./infisical-iac-bootstrap-api";

export type InfisicalRepoProject = {
  id: string;
  name: string;
  slug?: string;
  orgId?: string;
};

export const REPO_INFISICAL_PROJECT_NAME = "viberoots-deployments";

export async function ensureInfisicalRepoProject(
  api: InfisicalApi,
  organizationId: string,
  projectName = REPO_INFISICAL_PROJECT_NAME,
) {
  const existing = await findInfisicalRepoProject(api, organizationId, projectName);
  if (existing) return { project: existing, changed: false };
  const created = await createInfisicalRepoProject(api, organizationId, projectName);
  return { project: created, changed: true };
}

export async function validateInfisicalRepoProject(
  api: InfisicalApi,
  organizationId: string,
  projectId: string,
  opts: { requireOrganizationEvidence?: boolean } = {},
) {
  const result = await api.request<ProjectListResponse>("GET", projectListEndpoint());
  const projects = projectsFromResponse(result);
  const project = projects.find((candidate) => {
    if (candidate.id !== projectId) return false;
    return opts.requireOrganizationEvidence
      ? candidate.orgId === organizationId
      : projectMatchesOrganization(candidate, organizationId);
  });
  if (project) return project;
  const sameIdProject = projects.find((candidate) => candidate.id === projectId);
  if (sameIdProject?.orgId) {
    throw new Error(
      `Infisical project ${projectId} belongs to organization ${sameIdProject.orgId}, not selected organization ${organizationId}; update the resolver profile projectId or rerun repo bootstrap with the matching organization`,
    );
  }
  if (sameIdProject && opts.requireOrganizationEvidence) {
    throw new Error(
      `Infisical project ${projectId} did not include organization evidence for selected organization ${organizationId}; update the resolver profile projectId or rerun repo bootstrap with an Infisical API response that includes orgId or organizationId`,
    );
  }
  throw new Error(
    `Infisical project ${projectId} was not found in organization ${organizationId}; update the resolver profile projectId or rerun repo bootstrap with access to create/select the repo project`,
  );
}

export async function findInfisicalRepoProject(
  api: InfisicalApi,
  organizationId: string,
  projectName = REPO_INFISICAL_PROJECT_NAME,
) {
  const result = await api.request<ProjectListResponse>("GET", projectListEndpoint());
  return projectsFromResponse(result).find(
    (project) =>
      project.name === projectName && projectMatchesOrganization(project, organizationId),
  );
}

export async function findInfisicalProjectByNameOrSlug(
  api: InfisicalApi,
  organizationId: string,
  opts: { name?: string; slug?: string },
) {
  const result = await api.request<ProjectListResponse>("GET", projectListEndpoint());
  return projectsFromResponse(result).find((project) => {
    if (!projectMatchesOrganization(project, organizationId)) return false;
    return Boolean(
      (opts.slug && project.slug === opts.slug) || (opts.name && project.name === opts.name),
    );
  });
}

export async function existingInfisicalEnvironmentSlugs(
  api: InfisicalApi,
  projectId: string,
  slugs: string[],
) {
  const existing: string[] = [];
  for (const slug of slugs) {
    const result = await api.request<unknown>(
      "GET",
      `/api/v1/workspace/${encodeURIComponent(projectId)}/environments/${encodeURIComponent(slug)}`,
      undefined,
      true,
    );
    if (result) existing.push(slug);
  }
  return existing;
}

async function createInfisicalRepoProject(
  api: InfisicalApi,
  organizationId: string,
  projectName: string,
) {
  const result = await api.request<ProjectCreateResponse>("POST", "/api/v1/projects", {
    projectName,
    type: "secret-manager",
    shouldCreateDefaultEnvs: true,
  });
  const project = projectFromUnknown(result?.workspace || result?.project);
  if (!project) throw new Error("Infisical project create response did not include a project id");
  return project;
}

type ProjectListResponse = {
  workspaces?: unknown[];
  projects?: unknown[];
};

type ProjectCreateResponse = {
  workspace?: unknown;
  project?: unknown;
};

function projectsFromResponse(result: ProjectListResponse | undefined) {
  return (result?.workspaces || result?.projects || [])
    .map(projectFromUnknown)
    .filter((project): project is InfisicalRepoProject => Boolean(project));
}

function projectFromUnknown(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const id = stringValue(record.id) || stringValue(record.projectId);
  const name = stringValue(record.name) || stringValue(record.projectName);
  const slug = stringValue(record.slug) || stringValue(record.projectSlug);
  const orgId = stringValue(record.orgId) || stringValue(record.organizationId);
  return id && name ? { id, name, slug, orgId } : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function projectListEndpoint() {
  return "/api/v1/projects?type=secret-manager";
}

function projectMatchesOrganization(project: InfisicalRepoProject, organizationId: string) {
  return !project.orgId || project.orgId === organizationId;
}
