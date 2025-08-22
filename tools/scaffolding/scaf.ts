#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";

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

async function cmdNew(args: string[], flags: Record<string,string>) {
  const [language, templateRaw, name] = args;
  if (!language || !templateRaw || !name) { usage(); process.exit(2); }
  const template = normalizeTemplateName(templateRaw);
  const root = path.join("tools","scaffolding","templates", language, template);
  if (!(await fs.pathExists(root))) { console.error(`template not found: ${language}/${template}`); process.exit(1); }
  const dest = flags.path || path.join(".tmp", name);
  const data: Record<string, any> = { name, language, template };
  for (const [k,v] of Object.entries(flags)) if (!["path","json"].includes(k)) data[k] = v;
  await fs.mkdirp(dest);
  await runCopierCopy(root, dest, data);
  console.log("created:", dest);
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
    case "update":
    case "regen":
    case "delete":
    case "ls":
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
