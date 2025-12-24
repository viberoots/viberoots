import path from "node:path";

import type { ScafContext } from "./types.ts";

import { parseScafArgv } from "./argv.ts";
import {
  cmdCompletions,
  completeLanguages,
  completeTargets,
  completeTemplatesFor,
} from "./commands/completions.ts";
import { cmdDelete } from "./commands/delete.ts";
import { cmdGoTest } from "./commands/go-test.ts";
import { cmdHelp } from "./commands/help.ts";
import { cmdLanguage } from "./commands/language.ts";
import { cmdLs } from "./commands/ls.ts";
import { cmdMove } from "./commands/move.ts";
import { cmdNew } from "./commands/new.ts";
import { cmdTemplate } from "./commands/template.ts";
import { cmdTemplates } from "./commands/templates.ts";
import { cmdUpdateOrRegen } from "./commands/update-regen.ts";
import { usage } from "./usage.ts";

import { validateTemplates } from "../validate.ts";
import { getArgvTokens } from "../../lib/cli.ts";

function repoRootFromScafModuleUrl(): string {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return path.resolve(here, "..", "..", "..");
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
    const envRoot = (process.env.WORKSPACE_ROOT || process.env.BUCK_TEST_SRC || "").trim();
    const envRootAbs = envRoot ? path.resolve(envRoot) : "";
    const underBuck = Boolean(
      process.env.BUCK_TEST_TARGET || process.env.BUCK_TARGET || process.env.BUCK_TEST_SRC,
    );
    const hasSandboxRoot = Boolean(envRootAbs);
    const usingLiveRoot = hasSandboxRoot && envRootAbs === repoRoot;
    if (underBuck && (!hasSandboxRoot || usingLiveRoot)) {
      console.error(
        "error: refusing to scaffold in the live repo under Buck tests; use runInTemp so WORKSPACE_ROOT points to a temp workspace",
      );
      process.exit(2);
    }
  } catch {}
}

export async function runScafCli() {
  const ctx: ScafContext = { originalCwd: process.cwd(), repoRoot: repoRootFromScafModuleUrl() };

  normalizeCwd(ctx.repoRoot);
  guardBuckTests(ctx.repoRoot);

  const { positionals, flags } = parseScafArgv(getArgvTokens());
  const [cmd, ...rest] = positionals;

  switch (cmd) {
    case "templates":
      return cmdTemplates(rest, flags);
    case "new":
      if (rest[0] === "go" && rest[1] === "test") {
        const name = rest[2];
        if (!name) {
          console.error("Usage: scaf new go test <name_of_test> [--path=DEST] [--yes] [--dry-run]");
          process.exit(2);
        }
        return cmdGoTest(ctx, name, flags);
      }
      return cmdNew(rest, flags);
    case "language":
      return cmdLanguage(rest, flags);
    case "update":
      return cmdUpdateOrRegen("update", rest, flags);
    case "regen":
      return cmdUpdateOrRegen("regen", rest, flags);
    case "delete":
      return cmdDelete(rest, flags);
    case "move":
      return cmdMove(rest, flags);
    case "ls":
      return cmdLs(flags);
    case "help":
      return cmdHelp(rest, flags);
    case "template":
      return cmdTemplate(rest);
    case "validate":
      return validateTemplates(rest, flags["quiet"] === "true");
    case "completions":
      return cmdCompletions(rest);
    case "__complete":
      if (rest[0] === "languages") return completeLanguages();
      if (rest[0] === "templates") return completeTemplatesFor(rest[1] || "");
      if (rest[0] === "targets") return completeTargets();
      return process.exit(2);
    default:
      usage();
      return process.exit(cmd ? 2 : 0);
  }
}
