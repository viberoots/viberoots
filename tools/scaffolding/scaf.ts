#!/usr/bin/env zx-wrapper
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import "zx/globals";
import { printSkip } from "../lib/errors";
import {
  copierRecopyOrUpdate,
  copierUpdate,
  recopyUsingRecordedSource,
} from "./lib/scaffold-utils.ts";
import { validateTemplates } from "./validate.ts";

// Capture the user's original working directory before we normalize to repo root.
const ORIGINAL_CWD = process.cwd();

function usage() {
  console.log(`scaf <command> [...]

Commands:
  templates [<language>] [--json]
  new <language> <template> <name> [--path=DEST] [--key=value ...]
  language <new|plan|doctor|remove> [...]
  update <all|path1 path2 ...>
  regen  <all|path1 path2 ...>
  delete <all|path1 path2 ...> [--yes] [--dry-run]
  move <old-path> <new-path> [--yes] [--dry-run]
  ls [--json]
  help <language> <template> [--json]
  template <language> <template>
  validate <all|path1 path2 ...> [--quiet]
  completions <bash|zsh|fish>
  new go test <name_of_test> [--path=DEST] [--yes] [--dry-run]
`);
}

function parseArgs(argv: string[]): { _: string[]; flags: Record<string, string> } {
  const out: string[] = [];
  const flags: Record<string, string> = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v = "true"] = a.slice(2).split("=");
      flags[k] = v;
    } else {
      out.push(a);
    }
  }
  return { _: out, flags };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isLanguageEnabled(language: string): Promise<boolean> {
  // Heuristic gating to support partial clones: language is enabled only if its
  // required planner/template surface exists in this checkout.
  if (language === "go") {
    const goTpl = path.join("tools", "nix", "templates", "go.nix");
    const goDefs = path.join("go", "defs.bzl");
    return (await exists(goTpl)) && (await exists(goDefs));
  }
  if (language === "node") {
    // Node enablement follows the same rule as tools/lib/langs.ts: require at least one pnpm-lock.yaml
    try {
      const { globby } = await import("fast-glob");
      const locks = await globby(["**/pnpm-lock.yaml"], {
        gitignore: true,
        ignore: ["**/buck-out/**", "**/.tmp/**", "**/node_modules/**"],
      });
      return Array.isArray(locks) && locks.length > 0;
    } catch {
      // If globby is unavailable, fall back to conservative disable to avoid false-positives in partial clones
      return false;
    }
  }
  // Generic rule: require tools/nix/templates/<lang>.nix for other languages
  const tplPath = path.join("tools", "nix", "templates", `${language}.nix`);
  return await exists(tplPath);
}

async function readTemplateMeta(language?: string) {
  const root = path.join("tools", "scaffolding", "templates");
  let langs = language ? [language] : (await exists(root)) ? await fsp.readdir(root) : [];
  // Filter languages by enablement to support sparse checkouts
  const filtered: string[] = [];
  for (const l of langs) {
    if (await isLanguageEnabled(l)) filtered.push(l);
  }
  langs = filtered;
  const out: any[] = [];
  for (const l of langs) {
    const langDir = path.join(root, l);
    if (!(await exists(langDir))) {
      continue;
    }
    const entries = await fsp.readdir(langDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) {
        continue;
      }
      const tmpl = e.name;
      const tmplDir = path.join(langDir, tmpl);
      const metaPath = path.join(tmplDir, "meta.json");
      let meta: any = { language: l, template: tmpl };
      if (await exists(metaPath)) {
        try {
          meta = JSON.parse(await fsp.readFile(metaPath, "utf8"));
        } catch (err) {
          // Intentionally continue with default meta when JSON is invalid.
          // Justification: listing templates should not crash due to a bad file; validation will catch it.
          console.warn(`warning: failed to parse ${metaPath}:`, err);
        }
      } else {
        meta.description = `${l} ${tmpl}`;
      }
      // Try to read copier variables
      const variables = await readCopierVariables(tmplDir).catch(() => [] as string[]);
      out.push({
        language: l,
        template: tmpl,
        description: meta.description || "",
        help: meta.help || {},
        variables,
      });
    }
  }
  return out;
}

async function readCopierVariables(templateDir: string): Promise<string[]> {
  const cfgs = ["copier.yaml", "copier.yml", ".copier-answers.yml"];
  for (const c of cfgs) {
    const p = path.join(templateDir, c);
    if (await exists(p)) {
      const txt = await fsp.readFile(p, "utf8").catch(() => "");
      const vars: string[] = [];
      for (const m of txt.matchAll(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(?:"[^"]*"|\S*)\s*$/gm)) {
        const key = m[1];
        if (!key.startsWith("_")) {
          vars.push(key);
        }
      }
      return Array.from(new Set(vars));
    }
  }
  return [];
}

async function listTemplates(language?: string, json = false) {
  const metas = await readTemplateMeta(language);
  if (json) {
    console.log(JSON.stringify(metas, null, 2));
  } else {
    metas.forEach((m) => {
      const vars =
        Array.isArray((m as any).variables) && (m as any).variables.length
          ? (m as any).variables.join(",")
          : "-";
      console.log(`${m.language}\t${m.template}\t${m.description}\t${vars}`);
    });
  }
}

function normalizeTemplateName(name: string): string {
  if (name === "lib" || name === "library") {
    return "lib";
  }
  if (name === "cli-app" || name === "cli") {
    return "cli";
  }
  return name;
}

function resolveDestination(
  language: string,
  template: string,
  name: string,
  override?: string,
): { path: string; needsConfirm: boolean } {
  if (override) {
    return { path: override, needsConfirm: false };
  }
  // Configurable resolver
  const cfgPath = path.join("tools", "scaffolding", "resolver.json");
  try {
    const raw = fs.readFileSync(cfgPath, "utf8");
    const cfg = JSON.parse(raw || "{}");
    const langCfg = (cfg && typeof cfg === "object" ? cfg[language] : undefined) || {};
    let pattern = (langCfg && typeof langCfg === "object" ? langCfg[template] : undefined) as
      | string
      | undefined;
    if (!pattern) {
      const def = (cfg && typeof cfg === "object" ? cfg["default"] : undefined) || {};
      pattern = (def && typeof def === "object" ? def[template] : undefined) as string | undefined;
    }
    if (pattern && typeof pattern === "string") {
      return { path: pattern.replaceAll("{name}", name), needsConfirm: false };
    }
  } catch {
    // ignore; fall back to defaults
  }
  // No mapping: default to ./{name}, but require confirmation
  return { path: path.join(".", name), needsConfirm: true };
}

async function runCopierCopy(templateDir: string, dest: string, data: Record<string, any>) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "scaf-"));
  const answersPath = path.join(tmpDir, "answers.json");
  await fsp.writeFile(answersPath, JSON.stringify(data, null, 2), "utf8");
  try {
    const absTemplate = path.resolve(templateDir);
    const absDest = path.resolve(dest);
    await fsp.mkdir(absDest, { recursive: true });
    await $`copier copy --trust --defaults --force --data-file ${answersPath} ${absTemplate} ${absDest}`;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runPostSteps(dest: string) {
  // Lightweight, idempotent post-steps; skip when not applicable
  const goMod = path.join(dest, "go.mod");
  if (await exists(goMod)) {
    try {
      await $`bash -c 'cd ${dest} && go fmt ./... || true && go mod tidy || true'`;
    } catch {
      // Non-fatal; post-steps are best-effort
    }
  }
}

async function recordSource(dest: string, language: string, template: string) {
  const answers = path.join(dest, ".copier-answers.yml");
  const relSrc = path.join("tools", "scaffolding", "templates", language, template);
  const line = `scaf_src_path: ${relSrc}`;
  const existsAns = await exists(answers);
  if (!existsAns) {
    const name = path.basename(dest);
    const base = `name: ${name}\nlanguage: ${language}\ntemplate: ${template}\n${line}\n`;
    await fsp.writeFile(answers, base, "utf8");
    return;
  }
  let cur = await fsp.readFile(answers, "utf8").catch(() => "");
  // Ensure base keys exist via simple replace-or-append
  const ensureLine = (key: string, value: string) => {
    if (new RegExp(`^${key}:\\s`, "m").test(cur)) {
      cur = cur.replace(new RegExp(`^${key}:.*$`, "m"), `${key}: ${value}`);
    } else {
      cur += (cur.endsWith("\n") ? "" : "\n") + `${key}: ${value}\n`;
    }
  };
  ensureLine("name", path.basename(dest));
  ensureLine("language", language);
  ensureLine("template", template);
  if (!cur.includes("scaf_src_path:")) {
    cur += (cur.endsWith("\n") ? "" : "\n") + line + "\n";
  }
  await fsp.writeFile(answers, cur, "utf8");
}

async function readRegenInfo(targetDir: string): Promise<{
  src?: string;
  data: Record<string, any>;
}> {
  const answersFile = path.join(targetDir, ".copier-answers.yml");
  const txt = await fsp.readFile(answersFile, "utf8").catch(() => "");
  const src = /^scaf_src_path:\s*(\S+)/m.exec(txt)?.[1]?.trim();
  const name = /^name:\s*(\S+)/m.exec(txt)?.[1]?.trim() || path.basename(targetDir);
  const language = /^language:\s*(\S+)/m.exec(txt)?.[1]?.trim() || undefined;
  const template = /^template:\s*(\S+)/m.exec(txt)?.[1]?.trim() || undefined;
  const data: Record<string, any> = { name };
  if (language) data.language = language;
  if (template) data.template = template;
  return { src, data };
}

async function discoverScaffolds(
  root: string = ".",
): Promise<
  Array<{ path: string; language: string; template: string; name: string; templateRef?: string }>
> {
  const out: Array<{
    path: string;
    language: string;
    template: string;
    name: string;
    templateRef?: string;
  }> = [];
  for await (const f of walk(root)) {
    if (path.basename(f) === ".copier-answers.yml") {
      const dir = path.dirname(f);
      const name = path.basename(dir);
      const txt = await fsp.readFile(f, "utf8").catch(() => "");
      const lang =
        /language:\s*(\S+)/m.exec(txt)?.[1] || (dir.includes("libs/") ? "go" : "unknown");
      const tmpl =
        /template:\s*(\S+)/m.exec(txt)?.[1] || (dir.includes("libs/") ? "lib" : "unknown");
      const templateRef = /^scaf_src_path:\s*(\S+)/m.exec(txt)?.[1]?.trim();
      out.push({ path: dir, language: lang, template: tmpl, name, templateRef });
    }
  }
  return out;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if ([".git", "node_modules", "buck-out", ".direnv", ".gitignore", ".tmp"].includes(e.name)) {
        continue;
      }
      yield* walk(p);
    } else {
      yield p;
    }
  }
}

async function confirmOrExit(summary: string, yes: boolean, dry: boolean) {
  console.log(summary);
  if (dry) {
    console.log("[dry-run] no changes made");
    process.exit(0);
  }
  if (!yes) {
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input, output });
      const answer = (await rl.question("Proceed? [y/N] ")).trim().toLowerCase();
      rl.close();
      if (answer !== "y" && answer !== "yes") {
        console.error("Aborted. Use --yes to confirm.");
        process.exit(2);
      }
      return;
    }
    console.error("Aborted. Use --yes to confirm.");
    process.exit(2);
  }
}

async function isGitCleanCwd(): Promise<boolean> {
  try {
    const res = await $({ stdio: "pipe" })`git status --porcelain`;
    return res.stdout.trim().length === 0;
  } catch (err) {
    // If git is unavailable in context, treat as dirty to avoid destructive ops.
    console.warn("info: git status failed; assuming dirty working tree", err);
    return false;
  }
}

async function cmdUpdateOrRegen(
  mode: "update" | "regen",
  args: string[],
  flags: Record<string, string>,
) {
  const yes = flags["yes"] === "true";
  const dry = flags["dry-run"] === "true";
  const targets = args.length ? args : ["all"];
  const discovered = await discoverScaffolds(".");
  const chosen = targets[0] === "all" ? discovered.map((d) => d.path) : targets;
  await confirmOrExit(
    `${mode} ${chosen.length} scaffold(s):\n` + chosen.map((p) => ` - ${p}`).join("\n"),
    yes,
    dry,
  );
  for (const t of chosen) {
    if (mode === "regen") {
      // Staged regen when we have a recorded source; otherwise fall back.
      const { src, data } = await readRegenInfo(t);
      if (src) {
        const parent = path.dirname(t);
        const base = path.basename(t);
        const staged = path.join(parent, `${base}.scaf-stage-${Date.now()}`);
        // Move current scaffold out of the way
        await fsp.rename(t, staged);
        try {
          await runCopierCopy(src, t, data);
          await runPostSteps(t);
          // success: remove staged backup
          await fsp.rm(staged, { recursive: true, force: true });
        } catch (err) {
          // failure: restore original and surface error
          await fsp.rm(t, { recursive: true, force: true }).catch(() => {});
          await fsp.rename(staged, t).catch(() => {});
          throw err;
        }
      } else {
        // No recorded source; use non-staged fallback
        try {
          await recopyUsingRecordedSource(t);
        } catch {
          await copierRecopyOrUpdate(t);
        }
        await runPostSteps(t);
      }
    } else {
      try {
        await recopyUsingRecordedSource(t);
      } catch {
        await copierUpdate(t);
      }
      await runPostSteps(t);
    }
    console.log(`${mode} OK:`, t);
  }
}

async function cmdLs(flags: Record<string, string>) {
  const rows = await discoverScaffolds(".");
  if (flags.json) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    for (const r of rows) {
      const ref = r.templateRef ? `\t${r.templateRef}` : "";
      console.log(`${r.path}\t${r.language}\t${r.template}\t${r.name}${ref}`);
    }
  }
}

async function cmdDelete(args: string[], flags: Record<string, string>) {
  const yes = flags["yes"] === "true";
  const dry = flags["dry-run"] === "true";
  const discovered = await discoverScaffolds(".");
  const targets = args.length ? args : ["all"];
  const chosen = targets[0] === "all" ? discovered.map((d) => d.path) : args;
  await confirmOrExit(
    `Delete ${chosen.length} scaffold(s):\n` + chosen.map((p) => ` - ${p}`).join("\n"),
    yes,
    dry,
  );
  for (const p of chosen) {
    await fsp.rm(p, { recursive: true, force: true });
  }
  console.log("delete OK");
}

async function cmdMove(args: string[], flags: Record<string, string>) {
  const [oldPath, newPath] = args;
  const yes = flags["yes"] === "true";
  const dry = flags["dry-run"] === "true";
  if (!oldPath || !newPath) {
    usage();
    process.exit(2);
  }
  await confirmOrExit(`Move ${oldPath} -> ${newPath}`, yes, dry);
  await fsp.mkdir(path.dirname(newPath), { recursive: true });
  await fsp.rename(oldPath, newPath);
  const ans = path.join(newPath, ".copier-answers.yml");
  const name = path.basename(newPath);
  if (!(await exists(ans))) {
    await fsp.writeFile(ans, `name: ${name}\n`, "utf8");
  } else {
    let txt = await fsp.readFile(ans, "utf8");
    if (/^name:\s/m.test(txt)) {
      txt = txt.replace(/^name:\s.*$/m, `name: ${name}`);
    } else {
      txt += `\nname: ${name}\n`;
    }
    // Update simple module path if it resembles github.com/org/old-name
    if (/^module:\s/m.test(txt)) {
      const m = /^module:\s*(\S+)/m.exec(txt)?.[1] || "";
      const parts = m.split("/");
      if (parts.length >= 3) {
        parts[parts.length - 1] = name;
        const newModule = parts.join("/");
        txt = txt.replace(/^module:\s.*$/m, `module: ${newModule}`);
      }
    }
    await fsp.writeFile(ans, txt, "utf8");
  }
  // Do not auto-run update on move; user can invoke `scaf update` explicitly.
  console.log("move OK");
}

async function cmdCompletions(args: string[]) {
  const [shell] = args;
  const subcommands =
    "templates new update regen delete move ls help validate template completions";
  if (shell === "bash") {
    console.log(
      [
        "_scaf_complete() {",
        "  local cur prev;",
        "  COMPREPLY=();",
        '  cur="${COMP_WORDS[COMP_CWORD]}"',
        '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
        `  local subs="${subcommands}"`,
        "  if [[ ${COMP_CWORD} -eq 1 ]]; then",
        '    COMPREPLY=( $(compgen -W "$subs" -- "$cur") ); return;',
        "  fi",
        '  case "${COMP_WORDS[1]}" in',
        "    new)",
        "      if [[ ${COMP_CWORD} -eq 2 ]]; then",
        "        local langs=$(scaf templates --json 2>/dev/null | jq -r '.[].language' | sort -u);",
        '        COMPREPLY=( $(compgen -W "$langs" -- "$cur") ); return;',
        "      elif [[ ${COMP_CWORD} -eq 3 ]]; then",
        "        local tmpls=$(scaf templates --json 2>/dev/null | jq -r '.[].template' | sort -u);",
        '        COMPREPLY=( $(compgen -W "$tmpls" -- "$cur") ); return;',
        "      fi",
        "      ;;",
        "    update|regen|delete|ls|validate)",
        "      local targets=\"all $(scaf ls --json 2>/dev/null | jq -r '.[].path')\";",
        '      COMPREPLY=( $(compgen -W "$targets" -- "$cur") ); return;',
        "      ;;",

        "  esac",
        "}",
        "complete -F _scaf_complete scaf",
      ].join("\n"),
    );
    return;
  }
  if (shell === "zsh") {
    console.log(
      [
        "#compdef scaf",
        "_scaf_complete() {",
        `  local -a subs; subs=( ${subcommands} )`,
        "  if (( CURRENT == 2 )); then",
        "    _describe -t commands 'scaf subcommands' subs; return",
        "  fi",
        "  case $words[2] in",
        "    new)",
        "      if (( CURRENT == 3 )); then",
        "        compadd -- $(scaf __complete languages); return",
        "      elif (( CURRENT == 4 )); then",
        "        local lang=$words[3]",
        "        compadd -- $(scaf __complete templates $lang); return",
        "      fi",
        "      ;;",
        "    update|regen|delete|ls|validate)",
        "      compadd -- $(scaf __complete targets); return",
        "      ;;",

        "  esac",
        "}",
        "compdef _scaf_complete scaf",
      ].join("\n"),
    );
    return;
  }
  if (shell === "fish") {
    console.log(
      [
        "complete -c scaf -n '__fish_use_subcommand' -a 'templates'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'new'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'update'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'regen'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'delete'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'move'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'ls'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'help'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'validate'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'template'",
        "complete -c scaf -n '__fish_use_subcommand' -a 'completions'",
        "# dynamic for 'new'",
        "complete -c scaf -n '__fish_seen_subcommand_from new; and test (count (commandline -opc)) -eq 2' -a '(scaf __complete languages)'",
        "complete -c scaf -n '__fish_seen_subcommand_from new; and test (count (commandline -opc)) -eq 3' -a '(set -l lang (commandline -opc | sed -n 2p); scaf __complete templates $lang)'",
        "# dynamic for targets",
        "complete -c scaf -n '__fish_seen_subcommand_from update regen delete ls validate' -a '(scaf __complete targets)'",
        "# nothing special beyond new/templates completions",
      ].join("\n"),
    );
    return;
  }
}

async function cmdHelp(args: string[], flags: Record<string, string>) {
  const [a1, a2, a3] = args;
  const commands = new Set(["new", "update", "regen", "delete"]);
  if (a1 && commands.has(a1) && !a2) {
    const cmd = a1;
    const lines: string[] = [];
    switch (cmd) {
      case "new": {
        lines.push("Usage: scaf new <language> <template> <name> [--path=DEST] [--key=value ...]");
        lines.push("");
        lines.push("Examples:");
        lines.push("  scaf new go lib greeter-utilities");
        lines.push("  scaf new go cli greeter-cli");
        lines.push("");
        if (flags.json === "true") {
          console.log(
            JSON.stringify({ command: cmd, usage: lines[0], examples: lines.slice(2) }, null, 2),
          );
          return;
        }
        console.log(lines.join("\n"));
        return;
      }
      case "update": {
        lines.push("Usage: scaf update <all|path1 path2 ...> [--yes] [--dry-run]");
        lines.push("");
        lines.push("Examples:");
        lines.push("  scaf update all --dry-run");
        lines.push("  scaf update libs/demo-lib --yes");
        if (flags.json === "true") {
          console.log(
            JSON.stringify({ command: cmd, usage: lines[0], examples: lines.slice(2) }, null, 2),
          );
          return;
        }
        console.log(lines.join("\n"));
        return;
      }
      case "regen": {
        lines.push("Usage: scaf regen <all|path1 path2 ...> [--yes] [--dry-run]");
        lines.push("");
        lines.push("Examples:");
        lines.push("  scaf regen all --dry-run");
        lines.push("  scaf regen libs/demo-lib --yes");
        if (flags.json === "true") {
          console.log(
            JSON.stringify({ command: cmd, usage: lines[0], examples: lines.slice(2) }, null, 2),
          );
          return;
        }
        console.log(lines.join("\n"));
        return;
      }
      case "delete": {
        lines.push("Usage: scaf delete <all|path1 path2 ...> [--yes] [--dry-run]");
        lines.push("");
        lines.push("Examples:");
        lines.push("  scaf delete all --dry-run");
        lines.push("  scaf delete libs/demo-lib --yes");
        if (flags.json === "true") {
          console.log(
            JSON.stringify({ command: cmd, usage: lines[0], examples: lines.slice(2) }, null, 2),
          );
          return;
        }
        console.log(lines.join("\n"));
        return;
      }
    }
  }
  // Command-level: scaf help new go test
  if (a1 === "new" && a2 === "go" && a3 === "test") {
    const usageLine = "Usage: scaf new go test <name_of_test> [--path=DEST] [--yes] [--dry-run]";
    const notes = [
      "- Place tests under libs/<lib>/pkg/<pkg>/ for libs, apps/<app>/cmd/<app>/ for apps.",
      "- The file name will be suffixed with _test.go if missing.",
      "- Package is inferred from existing *.go, or 'main' under /cmd/, else directory name.",
      "- Default DEST is resolved from current directory:",
      "  • apps/<app> → apps/<app>/cmd/<app>/<name>_test.go",
      "  • libs/<lib> → libs/<lib>/pkg/<lib>/<name>_test.go",
      "  • inside those trees, writes into the current directory",
    ];
    const examples = [
      "scaf new go test handlers --path=libs/demo-lib/pkg/demo-lib/handlers_test.go",
      "scaf new go test main_case --path=apps/demo-cli/cmd/demo-cli/main_case_test.go",
    ];
    if (flags.json === "true") {
      console.log(
        JSON.stringify({ command: "new go test", usage: usageLine, notes, examples }, null, 2),
      );
      return;
    }
    console.log(
      [usageLine, "", ...notes, "", "Examples:", ...examples.map((e) => `  ${e}`)].join("\n"),
    );
    return;
  }
  // Command-level: scaf help new <language> <template> → usage + live variables preview
  if (a1 === "new" && a2 && a3) {
    const language = a2;
    const template = normalizeTemplateName(a3);
    const tmplDirPath = path.join("tools", "scaffolding", "templates", language, template);
    const variables = await readCopierVariables(tmplDirPath).catch(() => [] as string[]);
    if (flags.json === "true") {
      console.log(
        JSON.stringify(
          {
            command: "new",
            usage: "scaf new <language> <template> <name> [--path=DEST] [--key=value ...]",
            language,
            template,
            variables,
          },
          null,
          2,
        ),
      );
      return;
    }
    const lines: string[] = [];
    lines.push("Usage: scaf new <language> <template> <name> [--path=DEST] [--key=value ...]");
    lines.push("");
    lines.push("Variables:");
    if (variables.length) {
      for (const v of variables) {
        lines.push(`  - ${v}`);
      }
    } else {
      lines.push("  - (none detected)");
    }
    lines.push("");
    lines.push("Examples:");
    lines.push("  scaf new go lib greeter-utilities");
    lines.push("  scaf new go cli greeter-cli");
    console.log(lines.join("\n"));
    return;
  }
  // Command-level: scaf help new <language> → list templates for that language
  if (a1 === "new" && a2 && !a3) {
    const language = a2;
    const metas = await readTemplateMeta(language);
    if (flags.json === "true") {
      console.log(
        JSON.stringify(
          metas.map((m) => ({
            language: m.language,
            template: m.template,
            description: m.description || "",
            variables: (m as any).variables || [],
          })),
          null,
          2,
        ),
      );
      return;
    }
    const lines: string[] = [];
    lines.push(`# Available ${language} templates:`);
    lines.push("");
    for (const m of metas) {
      lines.push(`- ${m.template}: ${m.description || ""}`);
    }
    console.log(lines.join("\n"));
    return;
  }
  const [language, template] = args;
  if (!language || !template) {
    usage();
    console.log("\nAvailable templates:");
    const metas = await readTemplateMeta();
    metas.forEach((m) => console.log(`  ${m.language} ${m.template}\t${m.description}`));
    return; // exit 0
  }
  const tmplDir = path.join("tools", "scaffolding", "templates", language, template);
  const metas = await readTemplateMeta(language);
  const meta = metas.find((m) => m.template === template);
  if (!meta) {
    console.error("template not found for help");
    process.exit(1);
  }
  const h = meta.help || {};
  if (flags.json === "true") {
    const tmplDirPath = path.join("tools", "scaffolding", "templates", language, template);
    const variables = await readCopierVariables(tmplDirPath).catch(() => [] as string[]);
    console.log(
      JSON.stringify(
        {
          language,
          template,
          description: meta.description || "",
          help: h,
          variables,
        },
        null,
        2,
      ),
    );
    return;
  }
  const lines: string[] = [];
  if (meta.description) {
    lines.push(`# ${meta.description}`);
    lines.push("");
  }
  lines.push(h.usage || `scaf new ${language} ${template} <name>`);
  if (h.notes && Array.isArray(h.notes) && h.notes.length) {
    lines.push("");
    lines.push(...h.notes);
  }
  if (h.examples && Array.isArray(h.examples) && h.examples.length) {
    lines.push("");
    lines.push("Examples:");
    lines.push(...h.examples.map((e: string) => `  ${e}`));
  }
  console.log(lines.join("\n"));
}

async function cmdTemplates(args: string[], flags: Record<string, string>) {
  const lang = args[0];
  if (lang && !(await isLanguageEnabled(lang))) {
    printSkip("missing-language", `${lang}`);
    return;
  }
  await listTemplates(lang, Boolean(flags.json));
}

async function cmdTemplate(args: string[]) {
  const [language, tmpl] = args;
  if (!language || !tmpl) {
    usage();
    process.exit(2);
  }
  const dir = path.join("tools", "scaffolding", "templates", language, tmpl);
  if (await exists(dir)) {
    console.error("template already exists");
    process.exit(2);
  }
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify(
      {
        language,
        template: tmpl,
        description: `${language} ${tmpl}`,
        help: {
          usage: `scaf new ${language} ${tmpl} <name> [--path=DEST]`,
          notes: [
            `A minimal ${language} ${tmpl} template.`,
            "Variables: name (scaffold name), language, template",
          ],
          examples: [`scaf new ${language} ${tmpl} demo`],
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await fsp.writeFile(
    path.join(dir, "README.md.jinja"),
    `# {{ name }} (${language} ${tmpl})\n`,
    "utf8",
  );
  console.log("created template:", dir);
}

async function cmdNew(args: string[], flags: Record<string, string>) {
  const [language, templateRaw, name] = args;
  if (!language || !templateRaw || !name) {
    usage();
    process.exit(2);
  }
  if (language !== "language" && !(await isLanguageEnabled(language))) {
    printSkip("missing-language", `${language}`);
    return; // exit 0 for disabled language in sparse checkout
  }
  const template = normalizeTemplateName(templateRaw);
  const root = path.join("tools", "scaffolding", "templates", language, template);
  if (!(await exists(root))) {
    console.error(`template not found: ${language}/${template}`);
    process.exit(1);
  }
  const destInfo = resolveDestination(language, template, name, flags.path);
  // Special-case: language/kit scaffolds into the repo root by default
  const dest = language === "language" && template === "kit" ? "." : destInfo.path;
  // Always copy into the resolved destination
  let effectiveDest = dest;
  const data: Record<string, any> = { name, language, template };
  for (const [k, v] of Object.entries(flags)) {
    if (!["path", "json"].includes(k)) {
      data[k] = v;
    }
  }
  // Special-case: language/kit uses <name> as the language id unless overridden
  if (language === "language" && template === "kit") {
    if (!data["lang_id"]) data["lang_id"] = name;
    if (!data["display_name"]) {
      const cap = name.charAt(0).toUpperCase() + name.slice(1);
      data["display_name"] = cap;
    }
  }
  // Overwrite guard + dry-run support
  const yes = flags["yes"] === "true";
  const dry = flags["dry-run"] === "true";
  if (destInfo.needsConfirm && !(language === "language" && template === "kit")) {
    await confirmOrExit(`No resolver mapping found. Create at ${dest}?`, yes, dry);
  }
  const destExists = await exists(dest);
  const isNonEmpty = destExists
    ? (await fsp.readdir(dest).catch(() => [] as string[])).length > 0
    : false;
  const isLangKit = language === "language" && template === "kit";
  if (isNonEmpty && !yes && !isLangKit) {
    await confirmOrExit(`Directory not empty: ${dest}\nOverwrite via copier?`, false, dry);
  }
  if (dry) {
    console.log(`[dry-run] would create/update scaffold at: ${dest}`);
    return;
  }

  await runCopierCopy(root, effectiveDest, data);
  // No de-nesting workaround; templates must render into the resolved destination
  await recordSource(dest, language, template);
  await runPostSteps(dest);
  // Optional: for lang-kit/kit, generate a starter planner plugin from TS config
  if (language === "language" && template === "kit") {
    const withPlanner = ["true", "1", "yes"].includes((flags["with-planner"] || "").toLowerCase());
    if (withPlanner) {
      const langId = (data["lang_id"] as string) || name;
      const cfgDir = path.join("tools", "nix", "planner");
      const cfgPath = path.join(cfgDir, `${langId}.config.ts`);
      await fsp.mkdir(cfgDir, { recursive: true });
      if (!(await exists(cfgPath))) {
        const cfg = `export default {\n  id: ${JSON.stringify(langId)},\n  detect: { requireAnyLabels: [${JSON.stringify(`lang:${langId}`)}] },\n  kindRules: [\n    { ifHasAnyLabel: [\"kind:bin\"], thenKind: \"bin\" },\n    { ifHasAnyLabel: [\"kind:lib\"], thenKind: \"lib\" }\n  ],\n  modulesFile: { inheritFromGo: true },\n};\n`;
        await fsp.writeFile(cfgPath, cfg, "utf8");
      }
      try {
        await $`node tools/dev/planner-gen.ts --lang ${langId}`;
        console.log(`planner generated: tools/nix/planner/${langId}.nix`);
      } catch (e) {
        console.warn("warning: planner-gen failed:", e);
      }
    }
  }
  console.log("created:", dest);
}

// -----------------------
// language subcommands UX
// -----------------------

async function cmdLanguage(args: string[], flags: Record<string, string>) {
  const [sub, id] = args;
  if (!sub || (sub !== "doctor" && !id)) {
    console.error(
      "Usage: scaf language <new|plan|doctor|remove> <id> [flags]\n" +
        "Examples:\n" +
        "  scaf language new rust --display-name=Rust --kinds=bin,lib --manifest=write\n" +
        "  scaf language plan python --with-exporter --manifest=print\n" +
        "  scaf language doctor\n" +
        "  scaf language remove kotlin --yes",
    );
    process.exit(2);
  }
  if (sub === "doctor") {
    // Stub for PR 28; print minimal structure for now
    const json = flags["json"] === "true";
    const payload = {
      languages: [],
      note: "diagnostics stub; implement in PR 28",
    } as const;
    console.log(json ? JSON.stringify(payload, null, 2) : payload.note);
    return;
  }
  if (sub === "plan") {
    const display = flags["display-name"] || id.charAt(0).toUpperCase() + id.slice(1);
    const kinds = (flags["kinds"] || "bin,lib").split(",").map((s) => s.trim());
    const withPlanner = (flags["with-planner"] ?? "true").toString();
    const withProvider = (flags["with-provider"] ?? "true").toString();
    const withExporter = (flags["with-exporter"] ?? "true").toString();
    const manifest = (flags["manifest"] || "write").toString();
    const willCreate = [
      `tools/nix/planner/${id}.nix`,
      `tools/buck/providers/${id}.ts`,
      `tools/buck/exporter/lang/${id}.ts`,
      `tools/scaffolding/templates/${id}/...`,
      `patches/${id}/.gitkeep`,
      `docs/handbook/${id}-notes.md`,
      `tools/tests/${id}/contract/...`,
    ];
    console.log(
      JSON.stringify(
        {
          id,
          displayName: display,
          kinds,
          withPlanner,
          withProvider,
          withExporter,
          manifest,
          willCreate,
          manifestFragment: { id, displayName: display },
        },
        null,
        2,
      ),
    );
    return;
  }
  if (sub === "new") {
    // Step 1: scaffold language kit into repo
    await cmdNew(["language", "kit", id], flags);

    // Step 2: optionally update tools/nix/langs.json
    const noManifest = flags["no-manifest"] === "true";
    const manifestMode = (flags["manifest"] || (noManifest ? "skip" : "write")).toString();
    const display = flags["display-name"] || id.charAt(0).toUpperCase() + id.slice(1);
    const kinds = (flags["kinds"] || "bin,lib")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const fragment = {
      id,
      displayName: display,
      requiredPaths: [
        `tools/nix/planner/${id}.nix`,
        `tools/buck/exporter/lang/${id}.ts`,
        `tools/buck/providers/${id}.ts`,
      ],
      kinds,
      templatesDir: `tools/scaffolding/templates/${id}`,
    } as const;

    async function writeManifestEntry(): Promise<void> {
      const p = path.join("tools", "nix", "langs.json");
      const existsFile = await exists(p);
      if (!existsFile) {
        const doc = { enabled: [id], languages: [fragment] } as any;
        await fsp.mkdir(path.dirname(p), { recursive: true });
        await fsp.writeFile(p, JSON.stringify(doc, null, 2) + "\n", "utf8");
        return;
      }
      let raw: string = await fsp.readFile(p, "utf8").catch(() => "");
      if (!raw.trim()) raw = "{}";
      let json: any;
      try {
        json = JSON.parse(raw);
      } catch {
        json = {};
      }
      if (Array.isArray(json)) {
        // legacy array form
        const arr = json as any[];
        if (!arr.find((e) => e && e.id === id)) arr.push(fragment);
        await fsp.writeFile(p, JSON.stringify(arr, null, 2) + "\n", "utf8");
      } else if (json && typeof json === "object") {
        const langs = Array.isArray(json.languages) ? json.languages : [];
        if (!langs.find((e: any) => e && e.id === id)) langs.push(fragment);
        const enabled = new Set<string>(Array.isArray(json.enabled) ? json.enabled : []);
        enabled.add(id);
        json.languages = langs;
        json.enabled = Array.from(enabled).sort();
        await fsp.writeFile(p, JSON.stringify(json, null, 2) + "\n", "utf8");
      } else {
        const doc = { enabled: [id], languages: [fragment] } as any;
        await fsp.writeFile(p, JSON.stringify(doc, null, 2) + "\n", "utf8");
      }
      // Best-effort validate
      try {
        await $`node tools/dev/validate-langs.ts`;
      } catch {}
    }

    if (manifestMode === "write") await writeManifestEntry();
    else if (manifestMode === "print") {
      console.log(JSON.stringify({ manifestFragment: fragment }, null, 2));
    }

    // Step 3: optionally run codegen
    const doCodegen = flags["no-codegen"] === "true" ? false : true;
    if (doCodegen) {
      try {
        await $`node tools/dev/codegen.ts`;
      } catch (e) {
        console.warn("warning: codegen failed:", e);
      }
    }

    // Step 4: print follow-ups
    console.log(
      [
        "\nNext steps:",
        `- Edit tools/buck/exporter/lang/${id}.ts to implement detection/labels`,
        `- Edit tools/buck/providers/${id}.ts to add provider wiring`,
        `- Edit tools/nix/planner/${id}.nix to route build kinds (bin/lib)`,
        `- Add tests under tools/tests/${id}/contract/ if desired`,
        `- Run: tools/dev/langs-diagnose.ts --lang ${id} to verify status`,
      ].join("\n"),
    );
    return;
  }
  if (sub === "remove") {
    const yes = flags["yes"] === "true";
    const dry = flags["dry-run"] === "true";
    const summary = `Remove language ${id}: templates/providers/exporter/planner (non-destructive for user code)`;
    await confirmOrExit(summary, yes, dry);
    const rm = async (p: string) => fsp.rm(p, { recursive: true, force: true }).catch(() => {});
    await rm(path.join("tools/nix/planner", `${id}.nix`));
    await rm(path.join("tools/buck/providers", `${id}.ts`));
    await rm(path.join("tools/buck/exporter/lang", `${id}.ts`));
    await rm(path.join("tools/scaffolding/templates", id));
    await rm(path.join("patches", id));
    // Manifest handling omitted (to be completed with PR 21/30 integration)
    console.log("remove OK");
    return;
  }
  console.error("Unknown subcommand for language");
  process.exit(2);
}

async function completeLanguages(): Promise<void> {
  const metas = await readTemplateMeta();
  const langs = Array.from(new Set(metas.map((m) => m.language))).sort();
  console.log(langs.join("\n"));
}

async function completeTemplatesFor(lang: string): Promise<void> {
  const metas = await readTemplateMeta(lang);
  const tmpls = metas.filter((m) => m.language === lang).map((m) => m.template);
  console.log(Array.from(new Set(tmpls)).sort().join("\n"));
}

async function completeTargets(): Promise<void> {
  const rows = await discoverScaffolds(".");
  const lines = ["all", ...rows.map((r) => r.path)];
  console.log(lines.join("\n"));
}

async function main() {
  // Normalize CWD to repo root for consistent relative paths
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const root = path.resolve(here, "..", "..");
    process.chdir(root);
  } catch {}
  const raw = process.argv.slice(2);
  const { _, flags } = parseArgs(raw);
  const [cmd, ...rest] = _;
  switch (cmd) {
    case "templates":
      return cmdTemplates(rest, flags);
    case "new":
      // `scaf new go test <name>` generates a Go *_test.go file
      if (rest[0] === "go" && rest[1] === "test") {
        const name = rest[2];
        if (!name) {
          console.error("Usage: scaf new go test <name_of_test> [--path=DEST] [--yes] [--dry-run]");
          process.exit(2);
        }
        return cmdGoTest(name, flags);
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
      return validateTemplates(rest, flags.quiet === "true");
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// ---------------
// go test command
// ---------------

function ensureSuffix(name: string, suffix: string): string {
  return name.endsWith(suffix) ? name : name + suffix;
}

function toPascalCase(s: string): string {
  const parts = s
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/);
  return parts.map((p) => (p ? p[0].toUpperCase() + p.slice(1) : "")).join("");
}

function sanitizePkgName(s: string): string {
  let t = s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_");
  if (!/^[a-z_]/.test(t)) t = "_" + t;
  return t || "pkg";
}

async function inferPackageName(dir: string, destPath: string): Promise<string> {
  try {
    const entries = await fsp.readdir(dir);
    for (const e of entries) {
      if (!e.endsWith(".go")) continue;
      const txt = await fsp.readFile(path.join(dir, e), "utf8").catch(() => "");
      const m = /^\s*package\s+([a-zA-Z_][a-zA-Z0-9_]*)/m.exec(txt);
      if (m && m[1]) return m[1];
    }
  } catch {}
  if (destPath.includes(`${path.sep}cmd${path.sep}`)) return "main";
  return sanitizePkgName(path.basename(dir));
}

async function cmdGoTest(name: string, flags: Record<string, string>) {
  const yes = flags["yes"] === "true";
  const dry = flags["dry-run"] === "true";
  const provided = flags["path"];
  const filename = ensureSuffix(name, "_test.go");
  function repoRoot(): string {
    return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  }
  function defaultDestFromCwd(file: string): string {
    const root = repoRoot();
    const rel = path.relative(root, ORIGINAL_CWD);
    const parts = rel.split(path.sep).filter(Boolean);
    // apps/<app>
    if (parts[0] === "apps" && parts[1]) {
      const app = parts[1];
      if (parts[2] === "cmd" && parts[3] === app) {
        return path.join(ORIGINAL_CWD, file);
      }
      return path.join(root, "apps", app, "cmd", app, file);
    }
    // libs/<lib>
    if (parts[0] === "libs" && parts[1]) {
      const lib = parts[1];
      if (parts[2] === "pkg" && parts[3]) {
        return path.join(ORIGINAL_CWD, file);
      }
      return path.join(root, "libs", lib, "pkg", lib, file);
    }
    // Fallback: write in the caller's cwd (not repo root)
    return path.join(ORIGINAL_CWD, file);
  }
  const dest = provided ? provided : defaultDestFromCwd(filename);
  const dir = path.dirname(dest);

  const summary = `Create Go test: ${dest}`;
  if (!yes && !dry && (await exists(dest))) {
    console.error(`${summary}\nRefusing to overwrite without --yes`);
    process.exit(2);
  }
  if (dry) {
    const pkg = await inferPackageName(dir, dest);
    console.log(`[dry-run] would write ${dest} (package ${pkg})`);
    return;
  }
  await fsp.mkdir(dir, { recursive: true });
  const pkg = await inferPackageName(dir, dest);
  const funcName = toPascalCase(name);
  const contents = `package ${pkg}\n\nimport \"testing\"\n\nfunc Test${funcName}(t *testing.T) {\n}\n`;
  await fsp.writeFile(dest, contents, "utf8");
  try {
    await $`bash -lc ${`set -euo pipefail; go fmt ${dest} >/dev/null 2>&1 || true`}`;
  } catch {}
  // Hint about auto-wiring roots
  const hintLib =
    dest.includes(`${path.sep}libs${path.sep}`) && dest.includes(`${path.sep}pkg${path.sep}`);
  const hintApp =
    dest.includes(`${path.sep}apps${path.sep}`) && dest.includes(`${path.sep}cmd${path.sep}`);
  if (!hintLib && !hintApp) {
    console.warn(
      "note: for auto-wiring, place tests under libs/<lib>/pkg/<pkg>/ (lib) or apps/<app>/cmd/<app>/ (app)",
    );
  }
  console.log("created:", dest);
}
