#!/usr/bin/env zx-wrapper
import path from "node:path";
import "zx/globals";
import { getFlagBool, getFlagStr } from "../lib/cli";
import { resolveWorkspaceRootSync } from "../lib/repo";
import { liveRepoScaffoldGuardMessage, shouldRefuseLiveRepoScaffold } from "./scaf/live-repo-guard";

function usage(): void {
  console.log(
    [
      "new-pnpm-project --kind <cli|lib> --name <name> [--importer <id>] [--yes] [--run-setup]",
      "",
      "Examples:",
      "  new-pnpm-project --kind cli --name demo",
      "  new-pnpm-project --kind lib --name utils --importer projects/libs/utils",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  try {
    // Always respect a sandboxed workspace root when present (tests run in temp repos)
    const envRoot = (process.env.WORKSPACE_ROOT || process.env.BUCK_TEST_SRC || "").trim();
    if (envRoot) {
      process.chdir(path.resolve(envRoot));
    } else {
      process.chdir(
        resolveWorkspaceRootSync(process.cwd(), { ...process.env, WORKSPACE_ROOT: "" }),
      );
    }
  } catch {}
  // Guard: when invoked under tests/verify, require a sandboxed WORKSPACE_ROOT to avoid mutating live repo
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const realRoot = path.resolve(here, "..", "..", "..");
    if (
      shouldRefuseLiveRepoScaffold({
        cwd: process.cwd(),
        env: process.env,
        repoRoot: realRoot,
      })
    ) {
      console.error(liveRepoScaffoldGuardMessage());
      process.exit(2);
    }
  } catch {}

  const kind = getFlagStr("kind", "").toLowerCase();
  const name = getFlagStr("name", "") || getFlagStr("project", "") || getFlagStr("n", "");
  const importer =
    getFlagStr("importer", "") ||
    (kind === "lib" ? `projects/libs/${name}` : `projects/apps/${name}`);
  const yes = getFlagBool("yes");
  const runSetup = getFlagBool("run-setup");

  if (!kind || !name || (kind !== "cli" && kind !== "lib")) {
    usage();
    process.exit(2);
  }

  const template = kind === "cli" ? "cli" : "lib";
  const dest =
    kind === "cli" ? path.join("projects", "apps", name) : path.join("projects", "libs", name);

  const extra: string[] = [
    `--importer=${importer}`,
    `--pkgScope=${kind === "lib" ? "@libs" : "@apps"}`,
  ];
  const confirm = yes ? ["--yes"] : [];

  await $`scaf new ts ${template} ${name} ${confirm} ${extra}`;

  if (runSetup) {
    // Best-effort: create lockfile-only and refresh glue
    try {
      await $({ cwd: dest })`pnpm -w install --lockfile-only`;
    } catch {
      console.warn("warning: pnpm lockfile-only step failed (dev shell not loaded?)");
    }
    try {
      await $`node build-tools/tools/buck/sync-providers.ts --lang node`;
    } catch {
      console.warn(
        "warning: glue refresh failed; run export-graph/sync-providers/gen-auto-map manually",
      );
    }
  } else {
    console.log(
      [
        "\nNext steps:",
        `- (optional) pnpm -w install --lockfile-only   # inside ${dest}`,
        "- node build-tools/tools/buck/sync-providers.ts --lang node",
      ].join("\n"),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
