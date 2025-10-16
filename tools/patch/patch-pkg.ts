#!/usr/bin/env zx-wrapper
import path from "node:path";

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
    ].join("\n"),
  );
  process.exit(2);
}

const argvAll = (global as any).argv as any;
const [_subRaw, _lang, ...positional] = (argvAll._ as string[]) || [];
const sub = ((_subRaw as string) || "help").toLowerCase() as SubcommandName;
const lang = (_lang as string) || (argvAll.lang as string);
const rest: string[] = [...(positional as string[])];
// Pass-through select flags needed by language handlers (opt-in list to reduce surprises)
if (typeof argvAll.importer === "string" && argvAll.importer.trim() !== "") {
  rest.push("--importer", String(argvAll.importer));
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
