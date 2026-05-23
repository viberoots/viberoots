#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { resolveExistingInfisicalResources } from "../../deployments/infisical-iac-bootstrap-tofu-adoption";
import { runOpenTofu } from "../../deployments/infisical-iac-bootstrap-tofu";
import type { CommandRunner } from "../../deployments/infisical-iac-bootstrap-types";
import { reviewedMetadata } from "./infisical-iac-bootstrap.fixture";

test("OpenTofu adopts an existing reviewed Infisical project and environments", async () => {
  const calls: Array<{ method: string; endpoint: string }> = [];
  const api = {
    request: async (method: string, endpoint: string) => {
      calls.push({ method, endpoint });
      if (method === "GET" && endpoint.startsWith("/api/v1/projects?")) {
        return {
          projects: [
            {
              id: "proj_existing",
              name: reviewedMetadata.projectName,
              slug: reviewedMetadata.projectSlug,
              orgId: "org_1",
              environments: [{ slug: "staging" }, { slug: "prod" }],
            },
          ],
        };
      }
      if (method === "GET" && endpoint === "/api/v1/projects/proj_existing") {
        return {
          project: {
            id: "proj_existing",
            name: reviewedMetadata.projectName,
            environments: [{ slug: "staging" }, { slug: "prod" }],
          },
        };
      }
      throw new Error(`unexpected request: ${method} ${endpoint}`);
    },
  };

  const existing = await resolveExistingInfisicalResources(
    api as never,
    { ...DEFAULT_BOOTSTRAP_ARGS, organizationId: "org_1" },
    reviewedMetadata,
  );

  assert.deepEqual(existing, {
    projectId: "proj_existing",
    environmentSlugs: ["staging", "prod"],
  });
  assert.deepEqual(
    calls.map((call) => call.endpoint),
    ["/api/v1/projects?type=secret-manager", "/api/v1/projects/proj_existing"],
  );
});

test("OpenTofu passes existing resource adoption variables into plan", async () => {
  const calls: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const runner: CommandRunner = (call) => {
    calls.push(call);
    return "";
  };
  const api = {
    request: async (method: string, endpoint: string) => {
      if (method === "GET" && endpoint.startsWith("/api/v1/projects?")) {
        return {
          projects: [
            {
              id: "proj_existing",
              name: reviewedMetadata.projectName,
              slug: reviewedMetadata.projectSlug,
              orgId: "org_1",
              environments: [{ slug: "staging" }],
            },
          ],
        };
      }
      if (method === "GET" && endpoint === "/api/v1/projects/proj_existing") {
        return {
          project: {
            id: "proj_existing",
            name: reviewedMetadata.projectName,
            environments: [{ slug: "staging" }],
          },
        };
      }
      throw new Error(`unexpected request: ${method} ${endpoint}`);
    },
  };

  await runOpenTofu({
    args: {
      ...DEFAULT_BOOTSTRAP_ARGS,
      organizationId: "org_1",
      tofuPlanFile: ".local/test.tfplan",
      noTofuApply: true,
    },
    api: api as never,
    credential: credential(),
    reviewedMetadata,
    runner,
  });

  const plan = calls.find((call) => call.args[0] === "plan");
  assert.equal(plan?.env?.TF_VAR_existing_project_id, "proj_existing");
  assert.equal(plan?.env?.TF_VAR_existing_environment_slugs, '["staging"]');
});

test("OpenTofu does not switch to adoption when project is already in local state", async () => {
  const calls: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const runner: CommandRunner = (call) => {
    calls.push(call);
    if (call.args.join(" ") === "state list") return "infisical_project.pleomino\n";
    return "";
  };
  const api = {
    request: async () => {
      throw new Error("project lookup should not run when local state already manages project");
    },
  };

  await runOpenTofu({
    args: {
      ...DEFAULT_BOOTSTRAP_ARGS,
      organizationId: "org_1",
      tofuPlanFile: ".local/test.tfplan",
      noTofuApply: true,
    },
    api: api as never,
    credential: credential(),
    reviewedMetadata,
    runner,
  });

  const plan = calls.find((call) => call.args[0] === "plan");
  assert.equal(plan?.env?.TF_VAR_existing_project_id, "");
  assert.equal(plan?.env?.TF_VAR_existing_environment_slugs, "[]");
});

function credential() {
  return {
    clientId: "client-id",
    clientSecret: "client-secret",
    status: "reused" as const,
    remoteClientSecretRecords: 0,
    remoteClientSecretRecordSummaries: [],
  };
}
