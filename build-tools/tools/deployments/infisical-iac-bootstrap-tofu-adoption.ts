import type { InfisicalApi } from "./infisical-iac-bootstrap-api";
import {
  existingInfisicalEnvironmentSlugs,
  findInfisicalProjectByNameOrSlug,
} from "./infisical-iac-bootstrap-profile-api";
import type {
  BootstrapArgs,
  CommandRunner,
  DeploymentRuntimeMetadata,
} from "./infisical-iac-bootstrap-types";

export type ExistingInfisicalResources = {
  projectId?: string;
  environmentSlugs?: string[];
};

export async function resolveOpenTofuAdoption(opts: {
  api?: InfisicalApi;
  args: BootstrapArgs & { organizationId: string };
  reviewedMetadata: Required<DeploymentRuntimeMetadata>;
  tofuDir: string;
  runner: CommandRunner;
}): Promise<ExistingInfisicalResources> {
  if (!opts.api || tofuStateManagesProject(opts.runner, opts.tofuDir)) return {};
  return await resolveExistingInfisicalResources(opts.api, opts.args, opts.reviewedMetadata);
}

export async function resolveExistingInfisicalResources(
  api: InfisicalApi,
  args: BootstrapArgs & { organizationId: string },
  reviewed: Required<DeploymentRuntimeMetadata>,
): Promise<ExistingInfisicalResources> {
  const project = await findInfisicalProjectByNameOrSlug(api, args.organizationId, {
    name: reviewed.projectName,
    slug: reviewed.projectSlug,
  });
  if (!project) return {};
  const environmentSlugs = await existingInfisicalEnvironmentSlugs(
    api,
    project.id,
    Object.values(reviewed.environments).flatMap((environment) =>
      environment.slug ? [environment.slug] : [],
    ),
  );
  return { projectId: project.id, environmentSlugs };
}

function tofuStateManagesProject(runner: CommandRunner, tofuDir: string) {
  try {
    const stdout = runner({
      command: "tofu",
      args: ["state", "list"],
      cwd: tofuDir,
      capture: true,
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .some((line) => /^infisical_project\.[A-Za-z0-9_-]+$/.test(line));
  } catch {
    return false;
  }
}
