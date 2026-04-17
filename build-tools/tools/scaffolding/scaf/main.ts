import path from "node:path";

import type { ScafContext } from "./types.ts";

import { parseScafArgv } from "./argv.ts";
import { liveRepoScaffoldGuardMessage, shouldRefuseLiveRepoScaffold } from "./live-repo-guard.ts";
import { usage } from "./usage.ts";

import { getArgvTokens } from "../../lib/cli.ts";
import { runNodeWithZx } from "../../lib/node-run.ts";
import { validateTemplates } from "../validate.ts";

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

  normalizeCwd(ctx.repoRoot);
  guardBuckTests(ctx.repoRoot);

  const { positionals, flags } = parseScafArgv(getArgvTokens());
  const [cmd, ...rest] = positionals;
  if (requiresTemplateManifestPreflight(cmd, rest)) {
    await runTemplateManifestPreflight(ctx.repoRoot);
  }

  switch (cmd) {
    case "templates":
      return (await import("./commands/templates.ts")).cmdTemplates(rest, flags);
    case "new":
      if (rest[0] === "go" && rest[1] === "test") {
        const name = rest[2];
        if (!name) {
          console.error("Usage: scaf new go test <name_of_test> [--path=DEST] [--yes] [--dry-run]");
          process.exit(2);
        }
        return (await import("./commands/go-test.ts")).cmdGoTest(ctx, name, flags);
      }
      return (await import("./commands/new.ts")).cmdNew(rest, flags);
    case "language":
      return (await import("./commands/language.ts")).cmdLanguage(rest, flags);
    case "update":
      return (await import("./commands/update-regen.ts")).cmdUpdateOrRegen("update", rest, flags);
    case "regen":
      return (await import("./commands/update-regen.ts")).cmdUpdateOrRegen("regen", rest, flags);
    case "delete":
      return (await import("./commands/delete.ts")).cmdDelete(rest, flags);
    case "move":
      return (await import("./commands/move.ts")).cmdMove(rest, flags);
    case "ls":
      return (await import("./commands/ls.ts")).cmdLs(flags);
    case "help":
      return (await import("./commands/help.ts")).cmdHelp(rest, flags);
    case "template":
      return (await import("./commands/template.ts")).cmdTemplate(rest);
    case "validate":
      return validateTemplates(rest, flags["quiet"] === "true");
    case "completions":
      return (await import("./commands/completions.ts")).cmdCompletions(rest);
    case "__complete":
      if (rest[0] === "languages")
        return (await import("./commands/completions.ts")).completeLanguages();
      if (rest[0] === "templates")
        return (await import("./commands/completions.ts")).completeTemplatesFor(rest[1] || "");
      if (rest[0] === "targets")
        return (await import("./commands/completions.ts")).completeTargets();
      return process.exit(2);
    default:
      usage();
      return process.exit(cmd ? 2 : 0);
  }
}
