#!/usr/bin/env zx-wrapper
import path from "node:path";
import "zx/globals";
import { getFlagBool, getFlagStr } from "../lib/cli.ts";

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
      const here = path.dirname(new URL(import.meta.url).pathname);
      const root = path.resolve(here, "..", "..", "..");
      process.chdir(root);
    }
  } catch {}
  // Guard: when invoked under Buck tests, require a sandboxed WORKSPACE_ROOT to avoid mutating live repo
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const realRoot = path.resolve(here, "..", "..", "..");
    const envRootRaw = (process.env.WORKSPACE_ROOT || process.env.BUCK_TEST_SRC || "").trim();
    const envRootAbs = envRootRaw ? path.resolve(envRootRaw) : "";
    const underBuck = Boolean(
      process.env.BUCK_TEST_TARGET || process.env.BUCK_TARGET || process.env.BUCK_TEST_SRC,
    );
    const hasSandboxRoot = Boolean(envRootAbs);
    const repoRootRaw = String(process.env.REPO_ROOT || "").trim();
    const liveRootAbs = repoRootRaw ? path.resolve(repoRootRaw) : realRoot;
    const usingLiveRoot = hasSandboxRoot && envRootAbs === liveRootAbs;
    if (underBuck && (!hasSandboxRoot || usingLiveRoot)) {
      console.error(
        "error: refusing to scaffold in the live repo under Buck tests; ensure WORKSPACE_ROOT points to a temp workspace (use runInTemp)",
      );
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

  await $`scaf new node ${template} ${name} ${confirm} ${extra}`;

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
