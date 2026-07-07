#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureInfisicalRepoProject } from "../../deployments/infisical-iac-bootstrap-profile-api";

test("repo project creation failure explains how to reuse an existing Infisical project", async () => {
  await assert.rejects(
    () =>
      ensureInfisicalRepoProject(
        fakeProjectApi([
          { id: "proj_existing", name: "shared-secrets", slug: "shared-secrets", orgId: "org_1" },
          { id: "proj_other_org", name: "other-org", orgId: "org_2" },
        ]) as never,
        "org_1",
      ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Infisical plan limit reached/);
      assert.match(error.message, /Reuse an existing Infisical secret-manager project/);
      assert.match(error.message, /projects\/config\/shared\.json/);
      assert.match(error.message, /VBR_INFISICAL_PROJECT_ID/);
      assert.match(error.message, /shared-secrets id=proj_existing slug=shared-secrets/);
      assert.doesNotMatch(error.message, /Infisical API POST/);
      assert.doesNotMatch(error.message, /proj_other_org/);
      return true;
    },
  );
});

function fakeProjectApi(
  projects: Array<{ id: string; name: string; slug?: string; orgId?: string }>,
) {
  return {
    async request(method: string) {
      if (method === "GET") return { projects };
      throw new Error(
        'Infisical API POST /api/v1/projects failed with HTTP 400: {"message":"Failed to create workspace due to plan limit reached."}',
      );
    },
  };
}
