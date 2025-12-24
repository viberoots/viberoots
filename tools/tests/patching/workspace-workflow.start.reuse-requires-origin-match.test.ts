#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { getSession, setSession } from "../../patch/state";
import { startWorkspaceWorkflow } from "../../patch/lib/workspace-workflow";

test("workspace workflow start reuses only when origin matches", async () => {
  await runInTemp("workspace-workflow-start-origin-match", async (tmp) => {
    const prevCwd = process.cwd();
    const prevWsRoot = process.env.WORKSPACE_ROOT;
    const prevOverride = process.env.NIX_PATCH_TEST_OVERRIDE_JSON;
    try {
      process.chdir(tmp);
      process.env.WORKSPACE_ROOT = tmp;
      process.env.NIX_PATCH_TEST_OVERRIDE_JSON = "{}";

      const originA = path.join(tmp, "origA");
      const originB = path.join(tmp, "origB");
      await fs.mkdirp(originA);
      await fs.mkdirp(originB);

      const key = "example@v1";
      await setSession("go", key, {
        importPath: "example",
        version: "v1",
        originPath: originA,
        workspacePath: path.join(tmp, "ws-old"),
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      });

      const ws = await startWorkspaceWorkflow({
        lang: "go",
        key,
        importPath: "example",
        version: "v1",
        originPath: originB,
        overrideEnvName: "NIX_PATCH_TEST_OVERRIDE_JSON",
        echoSnippetEnv: "PATCH_TEST_ECHO_SNIPPET",
        moduleKeyForWorkspace: key,
        deps: {
          makeWorkspace: async () => path.join(tmp, "ws-new"),
          pathExists: async () => true,
        },
      });
      if (ws !== path.join(tmp, "ws-new")) {
        console.error("expected new workspace path, got:", ws);
        process.exit(2);
      }

      const rec = await getSession("go", key);
      if (!rec || rec.originPath !== originB || rec.workspacePath !== ws) {
        console.error("expected session record to be updated to new origin/workspace");
        console.error("rec:", rec);
        process.exit(2);
      }
    } finally {
      try {
        process.chdir(prevCwd);
      } catch {}
      if (typeof prevWsRoot === "string") process.env.WORKSPACE_ROOT = prevWsRoot;
      else delete process.env.WORKSPACE_ROOT;
      if (typeof prevOverride === "string") process.env.NIX_PATCH_TEST_OVERRIDE_JSON = prevOverride;
      else delete process.env.NIX_PATCH_TEST_OVERRIDE_JSON;
    }
  });
});
