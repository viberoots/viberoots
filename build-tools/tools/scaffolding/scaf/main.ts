import path from "node:path";

import type { ScafContext } from "./types";

import { parseScafArgv } from "./argv";
import { liveRepoScaffoldGuardMessage, shouldRefuseLiveRepoScaffold } from "./live-repo-guard";
import { usage } from "./usage";

import { getArgvTokens } from "../../lib/cli";
import { runNodeWithZx } from "../../lib/node-run";
import { validateTemplates } from "../validate";

function repoRootFromScafModuleUrl(): string {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, "..", "..", "..", "..");
}

function normalizeCwd(repoRoot: string) {
  try {
    const envRoot = (process.env.WORKSPACE_ROOT || process.env.BUCK_TEST_SRC || "").trim();
    if (envRoot) {
      process.chdir(envRoot);
      return;
    }
    process.chdir(repoRoot);
  } catch {}
}

function guardBuckTests(repoRoot: string) {
  try {
    if (
      shouldRefuseLiveRepoScaffold({
        cwd: process.cwd(),
        env: process.env,
        repoRoot,
      })
    ) {
      console.error(liveRepoScaffoldGuardMessage());
      process.exit(2);
    }
  } catch {}
}

function requiresTemplateManifestPreflight(cmd: string | undefined, rest: string[]): boolean {
  if (!cmd) return false;
  if (cmd === "new" || cmd === "templates" || cmd === "template") return true;
  if (cmd === "__complete") {
    const scope = String(rest[0] || "").trim();
    return scope === "languages" || scope === "templates";
  }
  return false;
}

async function runTemplateManifestPreflight(repoRoot: string): Promise<void> {
  const script = path.join(
    repoRoot,
    "build-tools/tools/scaffolding/gen-template-manifest-artifacts.ts",
  );
  const zxInitPath = path.join(repoRoot, "build-tools/tools/dev/zx-init.mjs");
  await runNodeWithZx({
    cwd: process.cwd(),
    script,
    zxInitPath,
    stdio: "pipe",
  });
}

export async function runScafCli() {
  const ctx: ScafContext = { originalCwd: process.cwd(), repoRoot: repoRootFromScafModuleUrl() };
  process.env.VIBEROOTS_ROOT = process.env.VIBEROOTS_ROOT || ctx.repoRoot;

  normalizeCwd(ctx.repoRoot);
  guardBuckTests(ctx.repoRoot);

  const { positionals, flags } = parseScafArgv(getArgvTokens());
  const [cmd, ...rest] = positionals;
  if (requiresTemplateManifestPreflight(cmd, rest)) {
    await runTemplateManifestPreflight(ctx.repoRoot);
  }

  switch (cmd) {
    case "templates":
      return (await import("./commands/templates")).cmdTemplates(rest, flags);
    case "new":
      if (rest[0] === "go" && rest[1] === "test") {
        const name = rest[2];
        if (!name) {
          console.error("Usage: scaf new go test <name_of_test> [--path=DEST] [--yes] [--dry-run]");
          process.exit(2);
        }
        return (await import("./commands/go-test")).cmdGoTest(ctx, name, flags);
      }
      return (await import("./commands/new")).cmdNew(rest, flags);
    case "language":
      return (await import("./commands/language")).cmdLanguage(rest, flags);
    case "update":
      return (await import("./commands/update-regen")).cmdUpdateOrRegen("update", rest, flags);
    case "regen":
      return (await import("./commands/update-regen")).cmdUpdateOrRegen("regen", rest, flags);
    case "delete":
      return (await import("./commands/delete")).cmdDelete(rest, flags);
    case "move":
      return (await import("./commands/move")).cmdMove(rest, flags);
    case "ls":
      return (await import("./commands/ls")).cmdLs(flags);
    case "help":
      return (await import("./commands/help")).cmdHelp(rest, flags);
    case "template":
      return (await import("./commands/template")).cmdTemplate(rest);
    case "validate":
      return validateTemplates(rest, flags["quiet"] === "true");
    case "completions":
      return (await import("./commands/completions")).cmdCompletions(rest);
    case "__complete":
      if (rest[0] === "languages")
        return (await import("./commands/completions")).completeLanguages();
      if (rest[0] === "templates")
        return (await import("./commands/completions")).completeTemplatesFor(rest[1] || "");
      if (rest[0] === "targets") return (await import("./commands/completions")).completeTargets();
      return process.exit(2);
    default:
      usage();
      return process.exit(cmd ? 2 : 0);
  }
}
