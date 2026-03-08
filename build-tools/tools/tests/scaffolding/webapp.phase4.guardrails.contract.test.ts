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

const SOURCE_ONLY_EXPECTATIONS: InstallGuardrailExpectation[] = [
  {
    file: "build-tools/tools/tests/scaffolding/webapp-ssr-vite.dev-reload.wasm-producer.test.ts",
    required: [
      "--skip-lockfile-gen",
      "pnpm install",
      "--filter ./projects/apps/demo-vite-ssr...",
      "--no-frozen-lockfile",
      "--prefer-offline",
      "--ignore-scripts",
    ],
    forbidden: ["--frozen-lockfile"],
  },
  {
    file: "build-tools/tools/tests/scaffolding/webapp-ssr-vite.dev-runtime-consistency.phase3.test.ts",
    required: [
      "--skip-lockfile-gen",
      "pnpm install",
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
      "pnpm install",
      "--no-frozen-lockfile",
      "--prefer-offline",
      "--ignore-workspace",
    ],
    forbidden: ["--frozen-lockfile"],
  },
];

const DEP_EDIT_EXPECTATIONS: InstallGuardrailExpectation[] = [
  {
    file: "build-tools/tools/tests/scaffolding/webapp-static.dev-hmr.local-ts-dep.test.ts",
    required: [
      "--skip-lockfile-gen",
      "pnpm install",
      "--filter ./projects/apps/demo-web...",
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
      "pnpm install",
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
      "pnpm install",
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
      "pnpm install",
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
      "pnpm install",
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

test("phase4 guardrails: source-only HMR tests keep frozen lockfile installs", async () => {
  for (const expectation of SOURCE_ONLY_EXPECTATIONS) {
    await assertContract(expectation);
  }
});

test("phase4 guardrails: dependency-edit HMR tests keep importer-scoped no-frozen installs", async () => {
  for (const expectation of DEP_EDIT_EXPECTATIONS) {
    await assertContract(expectation);
  }
});
