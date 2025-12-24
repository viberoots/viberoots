#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { setSession } from "../../patch/state";
import { applyWorkspaceWorkflow } from "../../patch/lib/workspace-workflow";

test("workspace workflow apply surfaces verify failures with context", async () => {
  await runInTemp("workspace-workflow-apply-verify-fail", async (tmp) => {
    const prevCwd = process.cwd();
    const prevWsRoot = process.env.WORKSPACE_ROOT;
    const prevOverride = process.env.NIX_PATCH_TEST_OVERRIDE_JSON;
    try {
      process.chdir(tmp);
      process.env.WORKSPACE_ROOT = tmp;
      process.env.NIX_PATCH_TEST_OVERRIDE_JSON = "{}";

      const origin = path.join(tmp, "origin");
      const workspace = path.join(tmp, "workspace");
      await fs.mkdirp(origin);
      await fs.mkdirp(workspace);

      const key = "example.com/mod@v1.2.3";
      await setSession("go", key, {
        importPath: "example.com/mod",
        version: "v1.2.3",
        originPath: origin,
        workspacePath: workspace,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      });

      const dst = path.join(tmp, "pkg", "patches", "go", "example.patch");
      const res = await applyWorkspaceWorkflow({
        lang: "go",
        key,
        missingSessionError: "missing",
        overrideEnvName: "NIX_PATCH_TEST_OVERRIDE_JSON",
        patchPathAbs: dst,
        verifyMode: "go",
        verifySubjectLabel: "Module",
        verifySubjectValue: "example.com/mod@v1.2.3",
        forceWrite: true,
        skipVerify: false,
        deps: {
          makeUnifiedDiff: async () => "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@\n",
          writePatchIfChanged: async () => "written",
          verifyPatchDryRun: async () => {
            throw new Error("boom");
          },
        },
      }).then(
        () => ({ ok: true as const, err: null as any }),
        (e) => ({ ok: false as const, err: e }),
      );

      if (res.ok) {
        console.error("expected apply to fail verification");
        process.exit(2);
      }

      const msg = String(res.err?.message || res.err || "");
      if (
        !msg.includes("Patch verification failed") ||
        !msg.includes("Module: example.com/mod@v1.2.3") ||
        !msg.includes(`Origin: ${origin}`) ||
        !msg.includes(`Patch: ${dst}`)
      ) {
        console.error("missing expected context in error message");
        console.error("--- message ---\n" + msg + "\n--- end ---");
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
