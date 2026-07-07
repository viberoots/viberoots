#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureInfisicalRepoProject } from "../../deployments/infisical-iac-bootstrap-profile-api";

test("repo project selector can adopt an existing Infisical project", async () => {
  const result = await ensureInfisicalRepoProject(
    fakeProjectApi([
      { id: "proj_existing", name: "shared-secrets", slug: "shared-secrets", orgId: "org_1" },
      { id: "proj_other_org", name: "other-org", orgId: "org_2" },
    ]) as never,
    "org_1",
    "fixture-repo",
    {
      allowInteractiveSelection: true,
      selectProject: async ({ projects, defaultProjectName }) => {
        assert.equal(defaultProjectName, "fixture-repo");
        assert.deepEqual(
          projects.map((project) => project.name),
          ["shared-secrets"],
        );
        return { kind: "existing", projectId: "proj_existing" };
      },
    },
  );

  assert.equal(result.changed, false);
  assert.equal(result.project.id, "proj_existing");
});

test("repo project selector can create with a custom project name", async () => {
  const api = fakeProjectApi([], { create: true });
  const result = await ensureInfisicalRepoProject(api as never, "org_1", "fixture-repo", {
    allowInteractiveSelection: true,
    selectProject: async ({ defaultProjectName }) => {
      assert.equal(defaultProjectName, "fixture-repo");
      return { kind: "create", projectName: "custom-repo-secrets" };
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.project.name, "custom-repo-secrets");
  assert.deepEqual(api.createdProjectNames, ["custom-repo-secrets"]);
});

test("repo project creation failure explains how to reuse an existing Infisical project", async () => {
  await assert.rejects(
    () =>
      ensureInfisicalRepoProject(
        fakeProjectApi([
          { id: "proj_existing", name: "shared-secrets", slug: "shared-secrets", orgId: "org_1" },
          { id: "proj_other_org", name: "other-org", orgId: "org_2" },
        ]) as never,
        "org_1",
        "fixture-repo",
      ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /BOOTSTRAP ERROR: Infisical project setup failed/);
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
  opts: { create?: boolean } = {},
) {
  return {
    createdProjectNames: [] as string[],
    async request(method: string, _endpoint?: string, body?: { projectName?: string }) {
      if (method === "GET") return { projects };
      if (opts.create) {
        const projectName = body?.projectName || "created-project";
        this.createdProjectNames.push(projectName);
        return { project: { id: "proj_created", name: projectName, orgId: "org_1" } };
      }
      throw new Error(
        'Infisical API POST /api/v1/projects failed with HTTP 400: {"message":"Failed to create workspace due to plan limit reached."}',
      );
    },
  };
}
