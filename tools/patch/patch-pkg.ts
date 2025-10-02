#!/usr/bin/env zx-wrapper
import path from "node:path";

type SubcommandName = "start" | "apply" | "reset" | "session" | "help";

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
      "",
      "languages:",
      "  go",
    ].join("\n"),
  );
  process.exit(2);
}

const [subRaw, lang, ...rest] = (global as any).argv._ as string[];
const sub = (subRaw || "help").toLowerCase() as SubcommandName;

async function main() {
  if (!sub || sub === "help") return usage();
  if (!lang) return usage("missing <language>");

  if (lang !== "go") {
    return usage(`unsupported language: ${lang}`);
  }

  // Resolve repo root to import the language handler robustly from any CWD
  const here = path.dirname(new URL(import.meta.url).pathname);
  const root = path.resolve(here, "..", "..");
  const go = await import(path.join(root, "tools/patch/patch-go.ts"));
  const handler = go.default as {
    start(args: string[]): Promise<void>;
    apply(args: string[]): Promise<void>;
    reset(args: string[]): Promise<void>;
    session(args: string[]): Promise<void>;
  };

  const map: Record<SubcommandName, (args: string[]) => Promise<void>> = {
    start: handler.start,
    apply: handler.apply,
    reset: handler.reset,
    session: handler.session,
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
