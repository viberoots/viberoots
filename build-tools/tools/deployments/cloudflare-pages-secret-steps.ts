#!/usr/bin/env zx-wrapper
import type { CloudflarePagesControlPlaneWorkerAuthority } from "./cloudflare-pages-control-plane-contract";
import type { CloudflarePagesAdmittedContext } from "./cloudflare-pages-admission";
import type { DeploymentRequirement, DeploymentRequirementStep } from "./deployment-requirements";
import { createDeploymentSecretRuntimeForAdmittedContext } from "./deployment-secret-runtime-helpers";

const CLOUDFLARE_API_TOKEN_SECRET = "cloudflare_api_token";

function declaresCloudflareApiToken(
  requirements: DeploymentRequirement[] | undefined,
  step: DeploymentRequirementStep,
): boolean {
  if (!requirements) return true;
  return requirements.some(
    (requirement) =>
      requirement.name === CLOUDFLARE_API_TOKEN_SECRET &&
      requirement.step === step &&
      requirement.required,
  );
}

export async function cloudflarePagesApiTokenForStep(opts: {
  admittedContext: CloudflarePagesAdmittedContext;
  step: DeploymentRequirementStep;
  authority?: CloudflarePagesControlPlaneWorkerAuthority;
}): Promise<string | undefined> {
  const runtime = createDeploymentSecretRuntimeForAdmittedContext({
    authority: opts.authority,
    admittedContext: opts.admittedContext,
  });
  const secrets = await runtime.enterStep(opts.step);
  const token = secrets[CLOUDFLARE_API_TOKEN_SECRET]?.trim();
  return token || undefined;
}

export async function requireCloudflarePagesApiTokenForStep(opts: {
  admittedContext: CloudflarePagesAdmittedContext;
  step: DeploymentRequirementStep;
  authority?: CloudflarePagesControlPlaneWorkerAuthority;
  requirements?: DeploymentRequirement[];
}): Promise<string> {
  if (!declaresCloudflareApiToken(opts.requirements, opts.step)) {
    throw new Error(
      `cloudflare-pages ${opts.step} requires declared secret requirement "${CLOUDFLARE_API_TOKEN_SECRET}"`,
    );
  }
  const token = await cloudflarePagesApiTokenForStep(opts);
  if (token) return token;
  throw new Error(
    `cloudflare-pages ${opts.step} requires admitted secret requirement "${CLOUDFLARE_API_TOKEN_SECRET}"`,
  );
}
