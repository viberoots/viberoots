#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const allowedWorkspaceRootUsers = new Set([
  "build-tools/tools/nix/flake/packages/importers.nix",
  "build-tools/tools/nix/flake/packages/node-cli.nix",
  "build-tools/tools/nix/flake/packages/node-service.nix",
  "build-tools/tools/nix/flake/packages/node-vercel-next.nix",
  "build-tools/tools/nix/flake/packages/node-webapp.nix",
  "build-tools/tools/nix/flake/packages/python.nix",
  "build-tools/tools/nix/flake/per-system-context.nix",
  "build-tools/tools/nix/templates/python.nix",
  "build-tools/tools/nix/templates/python/wasm-site.nix",
  "build-tools/tools/nix/templates/python/wasm.nix",
  "build-tools/tools/nix/uv2nix-env.nix",
  "build-tools/tools/nix/uv2nix-inputs.nix",
]);

async function nixFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await nixFiles(rel)));
    else if (entry.isFile() && rel.endsWith(".nix")) out.push(rel);
  }
  return out;
}

test("WORKSPACE_ROOT Nix env reads stay explicitly classified", async () => {
  const files = await nixFiles("build-tools/tools/nix");
  const users: string[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    if (text.includes('builtins.getEnv "WORKSPACE_ROOT"')) users.push(file);
  }
  assert.deepEqual(users.sort(), [...allowedWorkspaceRootUsers].sort());
});

test("remote-ready WORKSPACE_ROOT metadata requires declared snapshot and graph paths", async () => {
  const { validateRemoteExecTargets } = await import("../../dev/remote-exec-policy-check");
  const base = {
    target: "//pkg:t",
    ruleFamily: "go_nix_test",
    labels: ["remote:ready"],
    runFromProjectRoot: true,
    useProjectRelativePaths: true,
    commandInputsDeclared: true,
    requiresWorkspaceRootLookup: true,
    nixBuilderPolicy: "inherit_config",
    remoteBuilderSmokePolicy: "inherit_config",
  };
  assert.match(
    validateRemoteExecTargets({ mode: "remote", targets: [base] })
      .map((finding) => finding.message)
      .join("\n"),
    /declared source snapshot and graph paths/,
  );
  assert.deepEqual(
    validateRemoteExecTargets({
      mode: "remote",
      targets: [
        {
          ...base,
          sourceSnapshotRootDeclared: true,
          sourceSnapshotManifestDeclared: true,
          declaredGraphPath: true,
        },
      ],
    }),
    [],
  );
});
