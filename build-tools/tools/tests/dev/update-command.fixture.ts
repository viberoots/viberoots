import assert from "node:assert/strict";
import type { UpdateOperations } from "../../dev/update-command/run";

export const repairedAuthority = {
  artifactToolsRoot: "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-artifact-tools",
  goBin: "/nix/store/dddddddddddddddddddddddddddddddd-go/bin/go",
  pythonBin: "/nix/store/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee-python/bin/python3",
  viberootsSource: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-source",
};

export function operations(events: string[]): UpdateOperations {
  return {
    repairToolchainAuthority: async () => (events.push("toolchain"), repairedAuthority),
    validateTransactionTools: () => {},
    importers: async () => [".", "projects/apps/web"],
    repairPnpmLock: async (_root, importer) => {
      events.push(`repair:${importer}`);
    },
    upgradePnpm: async (_root, importer) => {
      events.push(`upgrade:${importer}`);
    },
    reconcilePnpm: async (_root, importer) => {
      events.push(`reconcile:${importer}`);
    },
    enabledLanguages: async () => ["go", "python", "cpp", "rust"],
    languageUpdates: {
      go: async (_root, _verbose, upgrade) => {
        events.push(`go:${upgrade ? "upgrade" : "repair"}`);
        return 1;
      },
      python: async (_root, _verbose, upgrade) => {
        events.push(`python:${upgrade ? "upgrade" : "repair"}`);
        return 1;
      },
      cpp: async () => 0,
      rust: async (_root, _verbose, upgrade) => {
        events.push(`rust:${upgrade ? "upgrade" : "repair"}`);
        return 1;
      },
    },
    repairWorkspaceLock: async (_root, _verbose, viberootsSource) => {
      assert.equal(viberootsSource, "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-source");
      events.push("workspace-lock");
    },
    repairGeneratedMetadata: async () => {
      events.push("cpp");
    },
  };
}
