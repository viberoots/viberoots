import type { InfisicalApi } from "./infisical-iac-bootstrap-api";
import {
  selectInfisicalRepoProject,
  shouldPromptForInfisicalProject,
  type InfisicalRepoProjectSelector,
} from "./infisical-iac-bootstrap-project-select";
import { repoProjectCreateFailureMessage } from "./infisical-iac-bootstrap-project-errors";

export type InfisicalRepoProject = {
  id: string;
  name: string;
  slug?: string;
  orgId?: string;
  environmentSlugs?: string[];
};

export async function ensureInfisicalRepoProject(
  api: InfisicalApi,
  organizationId: string,
  projectName: string,
  opts: {
    allowInteractiveSelection?: boolean;
    selectProject?: InfisicalRepoProjectSelector;
  } = {},
) {
  const projects = await listInfisicalProjects(api);
  const visibleProjects = projects.filter((project) =>
    projectMatchesOrganization(project, organizationId),
  );
  let effectiveProjectName = projectName;
  if (opts.selectProject || shouldPromptForInfisicalProject(opts.allowInteractiveSelection)) {
    const selected = await selectInfisicalRepoProject(
      visibleProjects,
      projectName,
      opts.selectProject,
    );
    if (selected.kind === "existing") {
      const project = visibleProjects.find((candidate) => candidate.id === selected.projectId);
      if (!project)
        throw new Error(`selected Infisical project ${selected.projectId} was not found`);
      return { project, changed: false };
    }
    effectiveProjectName = selected.projectName;
  }
  const existing = projects.find(
    (project) =>
      project.name === effectiveProjectName && projectMatchesOrganization(project, organizationId),
  );
  if (existing) return { project: existing, changed: false };
  const created = await createInfisicalRepoProject(api, effectiveProjectName, visibleProjects);
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
  projectName: string,
) {
  return (await listInfisicalProjects(api)).find(
    (project) =>
      project.name === projectName && projectMatchesOrganization(project, organizationId),
  );
}

export async function findInfisicalProjectByNameOrSlug(
  api: InfisicalApi,
  organizationId: string,
  opts: { name?: string; slug?: string },
) {
  return (await listInfisicalProjects(api)).find((project) => {
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
  const project = await readInfisicalProjectById(api, projectId);
  const existing = new Set(project?.environmentSlugs ?? []);
  return slugs.filter((slug) => existing.has(slug));
}

async function createInfisicalRepoProject(
  api: InfisicalApi,
  projectName: string,
  visibleProjects: InfisicalRepoProject[],
) {
  let result: ProjectCreateResponse | undefined;
  try {
    result = await api.request<ProjectCreateResponse>("POST", "/api/v1/projects", {
      projectName,
      type: "secret-manager",
      shouldCreateDefaultEnvs: true,
    });
  } catch (error) {
    throw new Error(repoProjectCreateFailureMessage(error, projectName, visibleProjects));
  }
  const project = projectFromUnknown(result?.workspace || result?.project);
  if (!project) throw new Error("Infisical project create response did not include a project id");
  return project;
}

async function listInfisicalProjects(api: InfisicalApi) {
  const result = await api.request<ProjectListResponse>("GET", projectListEndpoint());
  return projectsFromResponse(result);
}

type ProjectListResponse = {
  workspaces?: unknown[];
  projects?: unknown[];
};

type ProjectCreateResponse = {
  workspace?: unknown;
  project?: unknown;
};

type ProjectGetResponse = {
  workspace?: unknown;
  project?: unknown;
};

async function readInfisicalProjectById(api: InfisicalApi, projectId: string) {
  const result = await api.request<ProjectGetResponse>(
    "GET",
    `/api/v1/projects/${encodeURIComponent(projectId)}`,
    undefined,
    true,
  );
  return projectFromUnknown(result?.project || result?.workspace);
}

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
  const environmentSlugs = environmentSlugsFromUnknown(record.environments);
  return id && name ? { id, name, slug, orgId, environmentSlugs } : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function environmentSlugsFromUnknown(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const slug = stringValue((entry as Record<string, unknown>).slug);
        return slug ? [slug] : [];
      })
    : [];
}

function projectListEndpoint() {
  return "/api/v1/projects?type=secret-manager";
}

function projectMatchesOrganization(project: InfisicalRepoProject, organizationId: string) {
  return !project.orgId || project.orgId === organizationId;
}
