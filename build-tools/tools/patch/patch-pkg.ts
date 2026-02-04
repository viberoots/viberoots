#!/usr/bin/env zx-wrapper
// Ensure zx globals are available even in sandboxes without node_modules by
// importing the path discovered by zx-init when possible.
try {
  const url = process.env.ZX_GLOBALS_URL || "";
  if (url) {
    await import(url);
  } else {
    await import("zx/globals");
  }
} catch {
  try {
    await import("zx/globals");
  } catch {}
}
import path from "node:path";
import { getFlagBool, getFlagStr, getPositionals } from "../lib/cli.ts";
import { patchInvalidationStrategyForLang, patchPkgUsageNotes } from "../lib/lang-contracts.ts";

type SubcommandName = "start" | "apply" | "reset" | "session" | "remove" | "help";

function printPatchModelOneLiner(lang: string) {
  const s = patchInvalidationStrategyForLang(lang);
  if (!s) return;
  if (s.patchScope === "package-local") {
    console.error(`[patch-pkg] patch_scope:${s.patchScope} — no glue refresh is required`);
  } else {
    console.error(
      `[patch-pkg] patch_scope:${s.patchScope} — glue pipeline will run (graph, providers, auto_map)`,
    );
  }
}

function usage(msg?: string) {
  if (msg) console.error(msg);
  console.error(
    [
      "usage: patch-pkg <subcommand> <language> [...args]",
      "",
      "subcommands:",
      "  start <lang> <module>    Create a writable workspace and set dev override",
      "  apply <lang> <module>    Create/update canonical patch and regenerate glue",
      "  reset <lang> <module>    Drop workspace and clear dev override",
      "  session <lang> <module>  Start and attach; Ctrl-D=apply, Ctrl-C=reset",
      "  remove <lang> <module>   Remove a patch and regenerate glue",
      "",
      "languages:",
      "  go | cpp | node | python",
      "",
      "notes:",
      ...patchPkgUsageNotes().map((l) => `  ${l}`),
    ].join("\n"),
  );
  process.exit(2);
}

const [_subRaw, _lang, ...positional] = getPositionals();
const sub = ((_subRaw as string) || "help").toLowerCase() as SubcommandName;
const langFlag = getFlagStr("lang", "");
const lang = (_lang as string) || langFlag;
const rest: string[] = [...(positional as string[])];
// Pass-through select flags needed by language handlers (opt-in list to reduce surprises)
const importer = getFlagStr("importer", "");
if (importer.trim() !== "") {
  rest.push("--importer", importer);
}
const target = getFlagStr("target", "");
if (target.trim() !== "") {
  rest.push("--target", target);
}
// Support both dashed and camelCase variants commonly present via zx/minimist
const patchDirDashed = getFlagStr("patch-dir", "");
const patchDirCamel = getFlagStr("patchDir", "");
const patchDirVal = patchDirDashed || patchDirCamel;
if (patchDirVal.trim() !== "") {
  rest.push("--patch-dir", patchDirVal);
}
if (getFlagBool("force")) {
  rest.push("--force");
}

async function main() {
  if (!sub || sub === "help") return usage();
  if (!lang) return usage("missing <language>");

  if (lang !== "go" && lang !== "cpp" && lang !== "node" && lang !== "python")
    return usage(`unsupported language: ${lang}`);

  // Resolve repo root to import the language handler robustly from any CWD
  const here = path.dirname(new URL(import.meta.url).pathname);
  const root = path.resolve(here, "..", "..", "..");
  const go =
    lang === "go" ? await import(path.join(root, "build-tools/tools/patch/patch-go.ts")) : null;
  const cpp =
    lang === "cpp" ? await import(path.join(root, "build-tools/tools/patch/patch-cpp.ts")) : null;
  const node =
    lang === "node" ? await import(path.join(root, "build-tools/tools/patch/patch-node.ts")) : null;
  const py =
    lang === "python"
      ? await import(path.join(root, "build-tools/tools/patch/patch-python.ts"))
      : null;
  const handler = (go ? go.default : node ? node.default : py ? py.default : cpp!.default) as {
    start(args: string[]): Promise<void>;
    apply(args: string[]): Promise<void>;
    reset(args: string[]): Promise<void>;
    session(args: string[]): Promise<void>;
    remove?(args: string[]): Promise<void>;
  };

  const map: Record<SubcommandName, (args: string[]) => Promise<void>> = {
    start: handler.start,
    apply: handler.apply,
    reset: handler.reset,
    session: handler.session,
    remove: handler.remove || (async () => usage(`remove not supported for ${lang}`)),
    help: async () => usage(),
  };

  const fn = map[sub];
  if (!fn) return usage(`unknown subcommand: ${sub}`);
  await fn(rest);

  if (sub === "apply" || sub === "reset" || sub === "remove") {
    printPatchModelOneLiner(lang);
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
