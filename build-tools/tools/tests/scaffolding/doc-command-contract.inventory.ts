#!/usr/bin/env zx-wrapper

export type DocCommandContractEntry = {
  path: string;
  requiredFragments: string[];
};

export const ACTIVE_DOC_COMMAND_CONTRACT: DocCommandContractEntry[] = [
  {
    path: "viberoots/docs/handbook/getting-started-on-a-pr.md",
    requiredFragments: ["scaf new ts lib demo-lib --yes --dry-run", "scaf help ts webapp-ssr-vite"],
  },
  {
    path: "viberoots/docs/handbook/node-tests.md",
    requiredFragments: ["scaf new ts ..."],
  },
  {
    path: "viberoots/build-tools/docs/node-call-cpp.md",
    requiredFragments: ["scaf new ts cpp-addon <name>", "scaf new ts cpp-addon demo"],
  },
  {
    path: "viberoots/build-tools/docs/node-cpp-addon-plan.md",
    requiredFragments: ["scaf new ts cpp-addon demo"],
  },
  {
    path: "viberoots/build-tools/docs/wasm-linking.md",
    requiredFragments: ["scaf new ts wasm-linking-app <name>"],
  },
  {
    path: "viberoots/build-tools/docs/scaffolding.md",
    requiredFragments: [
      "scaf new ts webapp-ssr-vite demo-vite-ssr --yes",
      "scaf new deployment cloudflare-pages console-staging",
      "scaf new deployment cloudflare-containers console-ssr-staging",
      "scaf new deployment cloudflare-containers api-private",
      "scaf new deployment cloudflare-containers worker-none",
      "build-tools/tools/dev/build-wasm-producer.ts",
      "Hash-only or browser-storage-only client state is a poor fit for SSR-first ownership",
      "pnpm run preview -- --host 127.0.0.1 --port 4173",
    ],
  },
  {
    path: "viberoots/docs/deployments-usage.md",
    requiredFragments: [
      "scaf new deployment cloudflare-pages <deployment-id>",
      "scaf new deployment cloudflare-containers <deployment-id>",
      "scaf new deployment cloudflare-containers console-ssr-staging",
      "scaf new deployment cloudflare-containers api-private",
      "scaf new deployment cloudflare-containers worker-none",
    ],
  },
];

export const ARCHIVAL_DOC_COMMAND_CONTRACT: string[] = [
  "viberoots/docs/history/build-system/e2e-test-gaps.md",
  "viberoots/docs/history/build-system/logs/template-name-cleanup.md",
  "viberoots/docs/history/designs/legacy/linking-plan-3.md",
  "viberoots/docs/history/designs/legacy/nix-node-test.md",
  "viberoots/docs/history/designs/legacy/pnpm-pr-8.5.md",
  "viberoots/docs/history/build-system/pnpm/node-pr-3.5.md",
  "viberoots/docs/history/build-system/pnpm/node-golang-addon-test.md",
  "viberoots/docs/history/build-system/pnpm/node-golang-addon.md",
];

export function allClassifiedDocPaths(): string[] {
  return [
    ...ACTIVE_DOC_COMMAND_CONTRACT.map((entry) => entry.path),
    ...ARCHIVAL_DOC_COMMAND_CONTRACT,
  ];
}
