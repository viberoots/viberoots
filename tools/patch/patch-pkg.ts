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
import { getFlagStr, getFlagBool } from "../lib/cli.ts";

type SubcommandName = "start" | "apply" | "reset" | "session" | "remove" | "help";

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
      "  go | cpp | node",
      "",
      "notes:",
      "  - Go/C++ default to local mode: apply/remove write/read patches under <pkg>/patches/<lang>.",
      "    Removing a Go/C++ patch does not regenerate glue; Buck/Nix pick up the change via srcs.",
      "  - Node remains importer-scoped: apply/remove regenerates providers and auto_map (glue).",
    ].join("\n"),
  );
  process.exit(2);
}

function positionalArgs(): string[] {
  const g: any = (global as any).argv;
  if (g && Array.isArray(g._)) return g._ as string[];
  const raw = (process.argv || []).slice(2);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i] || "";
    if (a.startsWith("--")) continue; // keep behavior: treat non-flags as positionals
    out.push(a);
  }
  return out;
}

const [_subRaw, _lang, ...positional] = positionalArgs();
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

  if (lang !== "go" && lang !== "cpp" && lang !== "node")
    return usage(`unsupported language: ${lang}`);

  // Resolve repo root to import the language handler robustly from any CWD
  const here = path.dirname(new URL(import.meta.url).pathname);
  const root = path.resolve(here, "..", "..");
  const go = lang === "go" ? await import(path.join(root, "tools/patch/patch-go.ts")) : null;
  const cpp = lang === "cpp" ? await import(path.join(root, "tools/patch/patch-cpp.ts")) : null;
  const node = lang === "node" ? await import(path.join(root, "tools/patch/patch-node.ts")) : null;
  const handler = (go ? go.default : node ? node.default : cpp!.default) as {
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
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
