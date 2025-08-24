#!/usr/bin/env zx-wrapper
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import "zx/globals";
import {
  copierRecopyOrUpdate,
  copierUpdate,
  recopyUsingRecordedSource,
} from "./lib/scaffold-utils.ts";
import { validateTemplates } from "./validate.ts";

function usage() {
  console.log(`scaf <command> [...]

Commands:
  templates [<language>] [--json]
  new <language> <template> <name> [--path=DEST] [--key=value ...]
  update <all|path1 path2 ...>
  regen  <all|path1 path2 ...>
  delete <all|path1 path2 ...> [--yes] [--dry-run]
  move <old-path> <new-path> [--yes] [--dry-run]
  ls [--json]
  help <language> <template> [--json]
  template <language> <template>
  validate <all|path1 path2 ...> [--quiet]
  completions <bash|zsh|fish>
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

async function readTemplateMeta(language?: string) {
  const root = path.join("tools", "scaffolding", "templates");
  const langs = language ? [language] : (await exists(root)) ? await fsp.readdir(root) : [];
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
      const metaPath = path.join(langDir, tmpl, "meta.json");
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
      out.push({
        language: l,
        template: tmpl,
        description: meta.description || "",
        help: meta.help || {},
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
    metas.forEach((m) => console.log(`${m.language}\t${m.template}\t${m.description}`));
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
): string {
  if (override) {
    return override;
  }
  if (language === "go" && template === "lib") {
    return path.join("libs", name);
  }
  return path.join(".tmp", name);
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
      await $`bash -lc 'cd ${dest} && go fmt ./... || true && go mod tidy || true'`;
    } catch {
      // Non-fatal; post-steps are best-effort
    }
  }
}

async function recordSource(dest: string, language: string, template: string) {
  const answers = path.join(dest, ".copier-answers.yml");
  const relSrc = path.join("tools", "scaffolding", "templates", language, template);
  const line = `scaf_src_path: ${relSrc}`;
  let cur = "";
  try {
    cur = await fsp.readFile(answers, "utf8");
  } catch (err) {
    // Missing answers file is OK; we'll create/append below.
    console.warn(`info: no existing answers file at ${answers}; will create`, err);
  }
  if (!cur.includes("scaf_src_path:")) {
    await fsp.appendFile(answers, (cur.endsWith("\n") ? "" : "\n") + line + "\n", "utf8");
  }
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
  confirmOrExit(`Move ${oldPath} -> ${newPath}`, yes, dry);
  await fsp.mkdir(path.dirname(newPath), { recursive: true });
  await fsp.rename(oldPath, newPath);
  const ans = path.join(newPath, ".copier-answers.yml");
  if (await exists(ans)) {
    let txt = await fsp.readFile(ans, "utf8");
    const name = path.basename(newPath);
    if (/^name:\s/m.test(txt)) {
      txt = txt.replace(/name:\s.*$/, `name: ${name}`);
    } else {
      txt += `\nname: ${name}\n`;
    }
    await fsp.writeFile(ans, txt, "utf8");
  }
  if (await isGitCleanCwd()) {
    try {
      await copierUpdate(newPath);
    } catch (err) {
      // Non-fatal: move succeeded; copier update may fail if template state is inconsistent.
      console.warn("warning: copier update after move failed; continuing", err);
    }
  } else {
    console.log("(skipped update; working tree not clean)");
  }
  console.log("move OK");
}

async function cmdCompletions(args: string[]) {
  const [shell] = args;
  if (shell === "bash" || shell === "zsh") {
    console.log(
      "complete -W 'templates new update regen delete move ls help template validate' scaf",
    );
  }
}

async function cmdHelp(args: string[], flags: Record<string, string>) {
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
  await listTemplates(args[0], Boolean(flags.json));
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
  const template = normalizeTemplateName(templateRaw);
  const root = path.join("tools", "scaffolding", "templates", language, template);
  if (!(await exists(root))) {
    console.error(`template not found: ${language}/${template}`);
    process.exit(1);
  }
  const dest = resolveDestination(language, template, name, flags.path);
  const data: Record<string, any> = { name, language, template };
  for (const [k, v] of Object.entries(flags)) {
    if (!["path", "json"].includes(k)) {
      data[k] = v;
    }
  }
  // Overwrite guard + dry-run support
  const yes = flags["yes"] === "true";
  const dry = flags["dry-run"] === "true";
  const destExists = await exists(dest);
  const isNonEmpty = destExists
    ? (await fsp.readdir(dest).catch(() => [] as string[])).length > 0
    : false;
  if (isNonEmpty && !yes) {
    await confirmOrExit(`Directory not empty: ${dest}\nOverwrite via copier?`, false, dry);
  }
  if (dry) {
    console.log(`[dry-run] would create/update scaffold at: ${dest}`);
    return;
  }

  await runCopierCopy(root, dest, data);
  await recordSource(dest, language, template);
  await runPostSteps(dest);
  console.log("created:", dest);
}

async function main() {
  const raw = process.argv.slice(2);
  const { _, flags } = parseArgs(raw);
  const [cmd, ...rest] = _;
  switch (cmd) {
    case "templates":
      return cmdTemplates(rest, flags);
    case "new":
      return cmdNew(rest, flags);
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
    default:
      usage();
      return process.exit(cmd ? 2 : 0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
