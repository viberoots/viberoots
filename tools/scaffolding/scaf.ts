#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { copierRecopyOrUpdate, copierUpdate } from "./lib/scaffold-utils.ts";

function usage() {
  console.log(`scaf <command> [...]

Commands:
  templates [<language>] [--json]
  new <language> <template> <name> [--path=DEST] [--key=value ...]
  update <all|path1 path2 ...>
  regen  <all|path1 path2 ...>
  delete <all|path1 path2 ...>
  ls [--json]
  help [command]
  completions <bash|zsh|fish>
`);
}

function parseArgs(argv: string[]): { _: string[]; flags: Record<string,string> } {
  const out: string[] = [];
  const flags: Record<string,string> = {};
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k,v = "true"] = a.slice(2).split("=");
      flags[k] = v;
    } else out.push(a);
  }
  return { _: out, flags };
}

async function listTemplates(language?: string, json = false) {
  const root = path.join("tools","scaffolding","templates");
  const langs = language ? [language] : (await fs.pathExists(root) ? await fs.readdir(root) : []);
  const data: any[] = [];
  for (const l of langs) {
    const p = path.join(root, l);
    if (!(await fs.pathExists(p))) continue;
    const kinds = (await fs.readdir(p)).filter(x => (fs.statSync(path.join(p,x))).isDirectory());
    for (const k of kinds) data.push({ language: l, template: k });
  }
  if (json) console.log(JSON.stringify(data, null, 2));
  else for (const t of data) console.log(`${t.language}\t${t.template}`);
}

function normalizeTemplateName(name: string): string {
  if (name === "lib" || name === "library") return "lib";
  if (name === "cli-app" || name === "cli" || name === "app") return "cli-app";
  return name;
}

function resolveDestination(language: string, template: string, name: string, override?: string): string {
  if (override) return override;
  if (language === "go" && template === "lib") return path.join("libs", name);
  return path.join(".tmp", name);
}

async function runCopierCopy(templateDir: string, dest: string, data: Record<string, any>) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaf-"));
  const answersPath = path.join(tmpDir, "answers.json");
  await fs.outputFile(answersPath, JSON.stringify(data, null, 2), "utf8");
  try {
    await $`copier copy --trust --defaults --force --data-file ${answersPath} ${templateDir} ${dest}`;
  } finally {
    await fs.remove(tmpDir).catch(() => {});
  }
}

async function writeAnswers(pathDir: string, name: string, language: string, template: string) {
  const yml = [
    "# Recorded by scaf for discovery",
    `name: ${name}`,
    `language: ${language}`,
    `template: ${template}`,
  ].join("\n") + "\n";
  await fs.outputFile(path.join(pathDir, ".copier-answers.yml"), yml, "utf8");
}

async function cmdNew(args: string[], flags: Record<string,string>) {
  const [language, templateRaw, name] = args;
  if (!language || !templateRaw || !name) { usage(); process.exit(2); }
  const template = normalizeTemplateName(templateRaw);
  const root = path.join("tools","scaffolding","templates", language, template);
  if (!(await fs.pathExists(root))) { console.error(`template not found: ${language}/${template}`); process.exit(1); }
  const dest = resolveDestination(language, template, name, flags.path);
  const data: Record<string, any> = { name, language, template };
  for (const [k,v] of Object.entries(flags)) if (!["path","json"].includes(k)) data[k] = v;
  await fs.mkdirp(dest);
  await runCopierCopy(root, dest, data);
  await writeAnswers(dest, name, language, template);
  console.log("created:", dest);
}

async function discoverScaffolds(root: string = "."): Promise<Array<{path: string, language: string, template: string, name: string}>> {
  const out: Array<{path: string, language: string, template: string, name: string}> = [];
  for await (const f of walk(root)) {
    if (path.basename(f) === ".copier-answers.yml") {
      const dir = path.dirname(f);
      const name = path.basename(dir);
      // Try parse minimal yaml
      const txt = await fs.readFile(f, "utf8").catch(() => "");
      const lang = /language:\s*(\S+)/.exec(txt)?.[1] || (dir.includes("libs/") ? "go" : "unknown");
      const tmpl = /template:\s*(\S+)/.exec(txt)?.[1] || (dir.includes("libs/") ? "lib" : "unknown");
      out.push({ path: dir, language: lang, template: tmpl, name });
    }
  }
  return out;
}

async function* walk(dir: string): AsyncGenerator<string> {
  const list = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if ([".git","node_modules","buck-out",".direnv",".gitignore",".tmp"].includes(e.name)) continue;
      yield* walk(p);
    } else {
      yield p;
    }
  }
}

async function cmdUpdateOrRegen(mode: "update"|"regen", args: string[]) {
  const targets = args.length ? args : ["all"];
  const discovered = await discoverScaffolds(".");
  const chosen = targets[0] === "all" ? discovered.map(d => d.path) : targets;
  for (const t of chosen) {
    if (mode === "regen") await copierRecopyOrUpdate(t);
    else await copierUpdate(t);
    console.log(`${mode} OK:`, t);
  }
}

async function cmdLs(flags: Record<string,string>) {
  const rows = await discoverScaffolds(".");
  if (flags.json) console.log(JSON.stringify(rows, null, 2));
  else for (const r of rows) console.log(`${r.path}\t${r.language}\t${r.template}\t${r.name}`);
}

async function cmdTemplates(args: string[], flags: Record<string,string>) {
  await listTemplates(args[0], Boolean(flags.json));
}

async function main() {
  const raw = process.argv.slice(2);
  const { _, flags } = parseArgs(raw);
  const [cmd, ...rest] = _;
  switch (cmd) {
    case "templates": return cmdTemplates(rest, flags);
    case "new": return cmdNew(rest, flags);
    case "update": return cmdUpdateOrRegen("update", rest);
    case "regen": return cmdUpdateOrRegen("regen", rest);
    case "ls": return cmdLs(flags);
    case "delete":
    case "help":
    case "completions":
      console.error(`${cmd} not yet implemented (stub)`);
      return process.exit(2);
    default:
      usage();
      return process.exit(cmd ? 2 : 0);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
