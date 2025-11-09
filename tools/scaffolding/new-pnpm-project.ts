#!/usr/bin/env zx-wrapper
import path from "node:path";
import "zx/globals";

function parse(argv: string[]): { flags: Record<string, string>; name?: string } {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v = "true"] = a.slice(2).split("=");
      flags[k] = v;
    } else {
      rest.push(a);
    }
  }
  return { flags, name: rest[0] };
}

function usage(): void {
  console.log(
    [
      "new-pnpm-project --kind <cli|lib> --name <name> [--importer <id>] [--yes] [--run-setup]",
      "",
      "Examples:",
      "  new-pnpm-project --kind cli --name demo",
      "  new-pnpm-project --kind lib --name utils --importer libs/utils",
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
      const root = path.resolve(here, "..", "..");
      process.chdir(root);
    }
  } catch {}
  // Guard: when invoked under Buck tests, require a sandboxed WORKSPACE_ROOT to avoid mutating live repo
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const realRoot = path.resolve(here, "..", "..");
    const envRootRaw = (process.env.WORKSPACE_ROOT || process.env.BUCK_TEST_SRC || "").trim();
    const envRootAbs = envRootRaw ? path.resolve(envRootRaw) : "";
    const underBuck = Boolean(
      process.env.BUCK_TEST_TARGET || process.env.BUCK_TARGET || process.env.BUCK_TEST_SRC,
    );
    const hasSandboxRoot = Boolean(envRootAbs);
    const usingLiveRoot = hasSandboxRoot && envRootAbs === realRoot;
    if (underBuck && (!hasSandboxRoot || usingLiveRoot)) {
      console.error(
        "error: refusing to scaffold in the live repo under Buck tests; ensure WORKSPACE_ROOT points to a temp workspace (use runInTemp)",
      );
      process.exit(2);
    }
  } catch {}

  const { flags } = parse(process.argv.slice(2));
  const kind = (flags["kind"] || "").toLowerCase();
  const name = flags["name"] || flags["project"] || flags["n"] || "";
  const importer = flags["importer"] || (kind === "lib" ? `libs/${name}` : `apps/${name}`);
  const yes = flags["yes"] === "true" || flags["yes"] === "1";
  const runSetup = flags["run-setup"] === "true" || flags["run-setup"] === "1";

  if (!kind || !name || (kind !== "cli" && kind !== "lib")) {
    usage();
    process.exit(2);
  }

  const template = kind === "cli" ? "cli" : "lib";
  const dest = kind === "cli" ? path.join("apps", name) : path.join("libs", name);

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
      await $`node tools/buck/sync-providers-node.ts`;
      await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
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
        "- node tools/buck/sync-providers-node.ts",
        "- node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl",
      ].join("\n"),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
