#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

type InstallGuardrailExpectation = {
  file: string;
  required: string[];
  forbidden: string[];
};

const LIGHTWEIGHT_LOCAL_RUNTIME_EXPECTATIONS: InstallGuardrailExpectation[] = [
  {
    file: "build-tools/tools/tests/scaffolding/webapp.zero-wasm-default.static.contract.test.ts",
    required: [
      "--skip-store-hash-refresh",
      'import { pnpmInstallForDevTest, spawnStaticViteDevServer } from "./lib/dev-node-modules";',
      "pnpmInstallForDevTest({",
      'filter: "./projects/apps/demo-web...",',
    ],
    forbidden: [
      "--skip-lockfile-gen",
      "--no-frozen-lockfile",
      "pnpm --dir ${appAbs} install",
      "pnpm --dir ${tmp} install",
      "git add -A projects/apps/demo-web",
    ],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp.zero-wasm-default.ssr-next.contract.test.ts",
    required: [
      "--skip-store-hash-refresh",
      'import { pnpmInstallForDevTest, spawnNextSsrDevServer } from "./lib/dev-node-modules";',
      "pnpmInstallForDevTest({",
      'filter: "./projects/apps/demo-next...",',
    ],
    forbidden: [
      "--skip-lockfile-gen",
      "--no-frozen-lockfile",
      "pnpm --dir ${appAbs} install",
      "pnpm --dir ${tmp} install",
      "git add -A projects/apps/demo-next",
    ],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp.zero-wasm-default.ssr-vite.contract.test.ts",
    required: [
      "--skip-store-hash-refresh",
      'import { pnpmInstallForDevTest, spawnViteSsrDevServer } from "./lib/dev-node-modules";',
      "pnpmInstallForDevTest({",
      'filter: "./projects/apps/demo-vite...",',
    ],
    forbidden: [
      "--skip-lockfile-gen",
      "--no-frozen-lockfile",
      "pnpm --dir ${appAbs} install",
      "pnpm --dir ${tmp} install",
      "git add -A projects/apps/demo-vite",
    ],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-static-pwa.runtime-offline.contract.test.ts",
    required: [
      "--skip-store-hash-refresh",
      'import { pnpmInstallForDevTest } from "./lib/dev-node-modules";',
      "pnpmInstallForDevTest({",
      'filter: "./projects/apps/demo-pwa...",',
      "node scripts/build.mjs",
    ],
    forbidden: [
      "--skip-lockfile-gen",
      "--no-frozen-lockfile",
      "pnpm --dir ${appAbs} install",
      "pnpm --dir ${tmp} install",
      "pnpm --dir ${appAbs} run build",
      "deps-main.ts --verbose --glue-only",
      "nix build",
      "git add -A projects/apps/demo-pwa",
    ],
  },
];

const HEAVY_RUNTIME_EXPECTATIONS: InstallGuardrailExpectation[] = [
  {
    file: "build-tools/tools/tests/scaffolding/webapp.dev-server.running.test.ts",
    required: [
      "--skip-lockfile-gen",
      'import { ensureNodeModulesForDevApp } from "./lib/dev-node-modules";',
      "ensureNodeModulesForDevApp({",
    ],
    forbidden: ["--frozen-lockfile", "pnpmInstallForDevTest({"],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-ssr-vite.dev-reload.wasm-producer.test.ts",
    required: [
      "--skip-lockfile-gen",
      'import { ensureNodeModulesForDevApp, spawnViteSsrDevServer } from "./lib/dev-node-modules";',
      "ensureNodeModulesForDevApp({",
    ],
    forbidden: ["--frozen-lockfile", "pnpmInstallForDevTest({", 'spawn("pnpm", ["run", "dev"]'],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-ssr-vite.dev-runtime-consistency.test.ts",
    required: [
      "--skip-lockfile-gen",
      'import { pnpmInstallForDevTest, spawnViteSsrDevServer } from "./lib/dev-node-modules";',
      "pnpmInstallForDevTest({",
      'filter: "./projects/apps/demo-vite-ssr...",',
      'installMode: "raw-pnpm",',
    ],
    forbidden: ["--frozen-lockfile", "update-pnpm-hash.ts", "install/link-node.ts"],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-ssr-vite.dev-runtime-contract.test.ts",
    required: [
      "--skip-lockfile-gen",
      'import { pnpmInstallForDevTest, spawnViteSsrDevServer } from "./lib/dev-node-modules";',
      "pnpmInstallForDevTest({",
      'filter: "./projects/apps/demo-vite-ssr...",',
      'installMode: "raw-pnpm",',
    ],
    forbidden: ["--frozen-lockfile", "update-pnpm-hash.ts", "install/link-node.ts"],
  },
];

const RAW_PNPM_COMPATIBILITY_EXPECTATIONS: InstallGuardrailExpectation[] = [
  {
    file: "build-tools/tools/tests/scaffolding/lib/dev-node-modules.ts",
    required: [
      'installMode?: "nix" | "raw-pnpm";',
      'const node = resolveToolPathSync("node", env);',
      'const pnpm = resolveToolPathSync("pnpm", env);',
      'path.join(opts.tmp, "pnpm-workspace.yaml")',
      "await base`${node} ${pnpm} install ${sharedArgs} --lockfile-only --prefer-offline`;",
      "await base`${node} ${pnpm} install ${sharedArgs} --frozen-lockfile --prefer-offline`;",
      'opts.installMode === "raw-pnpm"',
      'opts.installMode === "raw-pnpm" && localPnpmStore',
      "...localPnpmStoreEnv,",
    ],
    forbidden: [
      "await base`${pnpm} install ${sharedArgs}",
      'update-pnpm-hash.ts")} --lockfile ${lockfile}`;\n  }\n  if (opts.installMode === "raw-pnpm")',
    ],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp.raw-pnpm-install.compat.contract.test.ts",
    required: [
      "--skip-store-hash-refresh",
      "pnpm --dir ${tmp} fetch",
      "--filter ./projects/apps/demo-web...",
      "--frozen-lockfile",
      "--prefer-offline",
      "--ignore-scripts",
      "--ignore-pnpmfile",
      "--reporter=append-only",
      "--network-concurrency 1",
      "--child-concurrency 1",
    ],
    forbidden: [
      "pnpm --dir ${tmp} install",
      "node scripts/build.mjs`",
      "spawn",
      "run build",
      "run dev",
    ],
  },
];

const DEP_EDIT_EXPECTATIONS: InstallGuardrailExpectation[] = [
  {
    file: "build-tools/tools/tests/scaffolding/webapp-static.dev-hmr.local-ts-dep.test.ts",
    required: ['from "./lib/webapp-local-ts-dep"'],
    forbidden: [],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-static-pwa.dev-hmr.local-ts-dep.test.ts",
    required: ['from "./lib/webapp-local-ts-dep"'],
    forbidden: [],
  },
  {
    file: "build-tools/tools/tests/scaffolding/lib/webapp-local-ts-dep.ts",
    required: [
      "--skip-lockfile-gen",
      "pnpmInstallForDevTest({",
      "filter: `./projects/apps/${options.appName}...`,",
      'installMode: "raw-pnpm",',
    ],
    forbidden: ["update-pnpm-hash.ts", "install/link-node.ts", "--filter ./projects/libs/demo-lib"],
  },
  {
    file: "build-tools/tools/tests/scaffolding/lib/webapp-ssr-vite-local-ts-dep.ts",
    required: [
      "--skip-lockfile-gen",
      "pnpmInstallForDevTest({",
      'filter: "./projects/apps/demo-vite-ssr...",',
      'installMode: "raw-pnpm",',
    ],
    forbidden: ["update-pnpm-hash.ts", "install/link-node.ts", "--filter ./projects/libs/demo-lib"],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-ssr-next.dev-hmr.local-ts-dep.test.ts",
    required: [
      "--skip-lockfile-gen",
      "pnpmInstallForDevTest({",
      'filter: "./projects/apps/demo-next-ssr...",',
      'installMode: "raw-pnpm",',
    ],
    forbidden: ["update-pnpm-hash.ts", "install/link-node.ts", "--filter ./projects/libs/demo-lib"],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-ssr-next.dev-reload.wasm-producer.test.ts",
    required: [
      "--skip-lockfile-gen",
      "pnpmInstallForDevTest({",
      'filter: "./projects/apps/demo-next-ssr...",',
      'installMode: "raw-pnpm",',
    ],
    forbidden: ["update-pnpm-hash.ts", "install/link-node.ts", "--filter ./projects/libs/demo-lib"],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-ssr-next.dev-runtime-consistency.test.ts",
    required: [
      "--skip-lockfile-gen",
      "pnpmInstallForDevTest({",
      'filter: "./projects/apps/demo-next-ssr...",',
      'installMode: "raw-pnpm",',
    ],
    forbidden: ["update-pnpm-hash.ts", "install/link-node.ts", "--filter ./projects/libs/demo-lib"],
  },
];

const TEMP_REPO_GIT_SCOPE_EXPECTATIONS: InstallGuardrailExpectation[] = [
  {
    file: "build-tools/tools/tests/scaffolding/node-service.scaffold-contract.test.ts",
    required: ["git -C ${tmp} add -A projects/apps/demo-service"],
    forbidden: ["git -C ${tmp} add -A;"],
  },
];

async function assertContract(expectation: InstallGuardrailExpectation): Promise<void> {
  const abs = path.join(process.cwd(), "viberoots", expectation.file);
  const text = await fsp.readFile(abs, "utf8");
  for (const requiredFragment of expectation.required) {
    assert.match(
      text,
      new RegExp(requiredFragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${expectation.file} is missing required install guardrail fragment: ${requiredFragment}`,
    );
  }
  for (const forbiddenFragment of expectation.forbidden) {
    assert.doesNotMatch(
      text,
      new RegExp(forbiddenFragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${expectation.file} contains forbidden install pattern: ${forbiddenFragment}`,
    );
  }
}

test("install guardrails: lightweight local-runtime tests keep scaffold lockfiles and frozen installs", async () => {
  for (const expectation of LIGHTWEIGHT_LOCAL_RUNTIME_EXPECTATIONS) {
    await assertContract(expectation);
  }
});

test("install guardrails: heavy runtime tests own install via skip-lockfile-gen", async () => {
  for (const expectation of HEAVY_RUNTIME_EXPECTATIONS) {
    await assertContract(expectation);
  }
});

test("install guardrails: raw pnpm compatibility is isolated from runtime smoke", async () => {
  for (const expectation of RAW_PNPM_COMPATIBILITY_EXPECTATIONS) {
    await assertContract(expectation);
  }
});

test("install guardrails: dependency-edit HMR tests keep importer-scoped no-frozen installs", async () => {
  for (const expectation of DEP_EDIT_EXPECTATIONS) {
    await assertContract(expectation);
  }
});

test("install guardrails: temp repo commits avoid generated runtime state", async () => {
  for (const expectation of TEMP_REPO_GIT_SCOPE_EXPECTATIONS) {
    await assertContract(expectation);
  }
});
