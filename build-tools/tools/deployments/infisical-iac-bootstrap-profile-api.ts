import type { InfisicalApi } from "./infisical-iac-bootstrap-api";

export type InfisicalRepoProject = {
  id: string;
  name: string;
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
) {
  const endpoint = `/api/v1/workspace?organizationId=${encodeURIComponent(organizationId)}`;
  const result = await api.request<ProjectListResponse>("GET", endpoint);
  const project = projectsFromResponse(result).find((candidate) => candidate.id === projectId);
  if (!project) {
    throw new Error(
      `Infisical project ${projectId} was not found in organization ${organizationId}; update the resolver profile projectId or rerun repo bootstrap with access to create/select the repo project`,
    );
  }
  return project;
}

export async function findInfisicalRepoProject(
  api: InfisicalApi,
  organizationId: string,
  projectName = REPO_INFISICAL_PROJECT_NAME,
) {
  const endpoint = `/api/v1/workspace?organizationId=${encodeURIComponent(organizationId)}`;
  const result = await api.request<ProjectListResponse>("GET", endpoint);
  return projectsFromResponse(result).find((project) => project.name === projectName);
}

async function createInfisicalRepoProject(
  api: InfisicalApi,
  organizationId: string,
  projectName: string,
) {
  const result = await api.request<ProjectCreateResponse>("POST", "/api/v1/workspace", {
    projectName,
    name: projectName,
    organizationId,
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
  return id && name ? { id, name } : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
