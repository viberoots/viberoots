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
      "pnpm --dir ${tmp} install",
      "--filter ./projects/apps/demo-web...",
      "--frozen-lockfile",
      "--prefer-offline",
      "--ignore-scripts",
    ],
    forbidden: ["--skip-lockfile-gen", "--no-frozen-lockfile", "git add -A projects/apps/demo-web"],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp.zero-wasm-default.ssr-next.contract.test.ts",
    required: [
      "--skip-store-hash-refresh",
      "pnpm --dir ${tmp} install",
      "--filter ./projects/apps/demo-next...",
      "--frozen-lockfile",
      "--prefer-offline",
      "--ignore-scripts",
    ],
    forbidden: [
      "--skip-lockfile-gen",
      "--no-frozen-lockfile",
      "git add -A projects/apps/demo-next",
    ],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp.zero-wasm-default.ssr-vite.contract.test.ts",
    required: [
      "--skip-store-hash-refresh",
      "pnpm --dir ${appAbs} install",
      "--ignore-workspace",
      "--frozen-lockfile",
      "--prefer-offline",
      "--ignore-scripts",
    ],
    forbidden: [
      "--skip-lockfile-gen",
      "--no-frozen-lockfile",
      "--filter ./projects/apps/demo-vite...",
      "git add -A projects/apps/demo-vite",
    ],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-static-pwa.runtime-offline.contract.test.ts",
    required: [
      "--skip-store-hash-refresh",
      "pnpm --dir ${appAbs} install",
      "--ignore-workspace",
      "--frozen-lockfile",
      "--prefer-offline",
      "--ignore-scripts",
      "pnpm --dir ${appAbs} run build",
    ],
    forbidden: [
      "--skip-lockfile-gen",
      "--no-frozen-lockfile",
      "deps-main.ts --verbose --glue-only",
      "update-pnpm-hash.ts --lockfile",
      "nix build",
      "--filter ./projects/apps/demo-pwa...",
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
    forbidden: ["--frozen-lockfile"],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-ssr-vite.dev-reload.wasm-producer.test.ts",
    required: [
      "--skip-lockfile-gen",
      'import { ensureNodeModulesForDevApp } from "./lib/dev-node-modules";',
      "ensureNodeModulesForDevApp({",
    ],
    forbidden: ["--frozen-lockfile"],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-ssr-vite.dev-runtime-consistency.test.ts",
    required: [
      "--skip-lockfile-gen",
      "pnpm --dir ${tmp} install",
      "--filter ./projects/apps/demo-vite-ssr...",
      "--no-frozen-lockfile",
      "--prefer-offline",
      "--ignore-scripts",
    ],
    forbidden: ["--frozen-lockfile"],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-ssr-vite.dev-runtime-contract.test.ts",
    required: [
      "--skip-lockfile-gen",
      "pnpm --dir ${appAbs} install",
      "--prefer-offline",
      "--ignore-workspace",
    ],
    forbidden: ["--frozen-lockfile"],
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
      "pnpm --dir ${tmp} install",
      "--filter ./projects/apps/${options.appName}...",
      "--no-frozen-lockfile",
      "--ignore-scripts",
    ],
    forbidden: [
      "pnpm install --ignore-scripts --reporter=append-only",
      "--filter ./projects/libs/demo-lib",
    ],
  },
  {
    file: "build-tools/tools/tests/scaffolding/lib/webapp-ssr-vite-local-ts-dep.ts",
    required: [
      "--skip-lockfile-gen",
      "pnpm --dir ${tmp} install",
      "--filter ./projects/apps/demo-vite-ssr...",
      "--no-frozen-lockfile",
      "--ignore-scripts",
    ],
    forbidden: [
      "pnpm install --ignore-scripts --reporter=append-only",
      "--filter ./projects/libs/demo-lib",
    ],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-ssr-next.dev-hmr.local-ts-dep.test.ts",
    required: [
      "--skip-lockfile-gen",
      "pnpm --dir ${tmp} install",
      "--filter ./projects/apps/demo-next-ssr...",
      "--no-frozen-lockfile",
      "--ignore-scripts",
    ],
    forbidden: [
      "pnpm install --ignore-scripts --reporter=append-only",
      "--filter ./projects/libs/demo-lib",
    ],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-ssr-next.dev-reload.wasm-producer.test.ts",
    required: [
      "--skip-lockfile-gen",
      "pnpm --dir ${tmp} install",
      "--filter ./projects/apps/demo-next-ssr...",
      "--no-frozen-lockfile",
      "--ignore-scripts",
    ],
    forbidden: [
      "pnpm install --ignore-scripts --reporter=append-only",
      "--filter ./projects/libs/demo-lib",
    ],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-ssr-next.dev-runtime-consistency.test.ts",
    required: [
      "--skip-lockfile-gen",
      "pnpm --dir ${tmp} install",
      "--filter ./projects/apps/demo-next-ssr...",
      "--no-frozen-lockfile",
      "--ignore-scripts",
    ],
    forbidden: [
      "pnpm install --ignore-scripts --reporter=append-only",
      "--filter ./projects/libs/demo-lib",
    ],
  },
];

async function assertContract(expectation: InstallGuardrailExpectation): Promise<void> {
  const abs = path.join(process.cwd(), expectation.file);
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

test("install guardrails: dependency-edit HMR tests keep importer-scoped no-frozen installs", async () => {
  for (const expectation of DEP_EDIT_EXPECTATIONS) {
    await assertContract(expectation);
  }
});
