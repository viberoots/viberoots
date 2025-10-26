#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

export async function seedAnswersViaCopier(
  templateDir: string,
  targetDir: string,
  data: Record<string, any>,
) {
  await runCopierFiltered([
    "copy",
    "--trust",
    "--defaults",
    "--force",
    "--data-file",
    await writeTempJson(data),
    templateDir,
    targetDir,
  ]);
}

export async function copierUpdate(targetDir: string) {
  const answers = path.join(targetDir, ".copier-answers.yml");
  if (await exists(answers)) {
    // If template variables are missing with no defaults, offer a friendlier UX
    await ensureTemplateVariables(targetDir, answers);
    await runCopierFiltered(["update", "--trust", "--defaults", "--answers-file", answers]);
  } else {
    throw new Error("No .copier-answers.yml for update");
  }
}

export async function copierRecopyOrUpdate(targetDir: string) {
  try {
    await runCopierFiltered(["recopy", "--trust", "--defaults", "--force", targetDir]);
  } catch {
    await copierUpdate(targetDir);
  }
}

export async function recopyUsingRecordedSource(targetDir: string) {
  const answersFile = path.join(targetDir, ".copier-answers.yml");
  if (!(await exists(answersFile))) {
    throw new Error("answers file missing");
  }
  const txt = await fsp.readFile(answersFile, "utf8");
  const src = /^scaf_src_path:\s*(\S+)/m.exec(txt)?.[1]?.trim();
  if (!src) {
    throw new Error("scaf_src_path not recorded in answers");
  }
  const name = /^name:\s*(\S+)/m.exec(txt)?.[1]?.trim() || path.basename(targetDir);
  const language = /^language:\s*(\S+)/m.exec(txt)?.[1]?.trim() || "";
  const template = /^template:\s*(\S+)/m.exec(txt)?.[1]?.trim() || "";
  const data = { name, language, template } as Record<string, any>;
  // Pre-flight: ensure required variables are present; prompt if interactive
  await ensureTemplateVariables(targetDir, answersFile, src, data);
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "scaf-"));
  try {
    const answersJson = path.join(tmpDir, "answers.json");
    await fsp.writeFile(answersJson, JSON.stringify(data, null, 2), "utf8");
    await runCopierFiltered([
      "copy",
      "--trust",
      "--defaults",
      "--force",
      "--answers-file",
      answersFile,
      "--data-file",
      answersJson,
      src,
      targetDir,
    ]);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch((err) => {
      // Non-fatal: temp dir cleanup best-effort; log and continue.
      console.warn("warning: failed to remove temp dir:", err);
    });
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch((err) => {
      // Non-fatal: temp dir cleanup best-effort; log and continue.
      console.warn("warning: failed to remove temp dir:", err);
    });
  }
}

export async function scaffoldOrUpdate(
  templateDir: string,
  targetDir: string,
  data: Record<string, any>,
) {
  if (await exists(path.join(targetDir, ".copier-answers.yml"))) {
    return copierRecopyOrUpdate(targetDir);
  }
  await seedAnswersViaCopier(templateDir, targetDir, data);
}

async function writeTempJson(obj: any): Promise<string> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "scaf-"));
  const p = path.join(tmpDir, "answers.json");
  await fsp.writeFile(p, JSON.stringify(obj, null, 2), "utf8");
  return p;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

function filterCopierLogs(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "Copying from template version None")
    .join("\n");
}

async function runCopierFiltered(args: string[]): Promise<void> {
  const res = await $({ stdio: "pipe" })`copier ${args}`.nothrow();
  const out = filterCopierLogs(String(res.stdout || ""));
  const err = filterCopierLogs(String(res.stderr || ""));
  if (out) process.stdout.write(out + (out.endsWith("\n") ? "" : "\n"));
  if (err) process.stderr.write(err + (err.endsWith("\n") ? "" : "\n"));
  if (res.exitCode && res.exitCode !== 0) {
    throw new Error(err || out || "copier failed");
  }
}

// ------------------------------
// Missing variable UX helpers
// ------------------------------

async function readTemplateVars(templateDir: string): Promise<string[]> {
  const candidates = ["copier.yaml", "copier.yml"];
  const vars: string[] = [];
  const reserved = new Set([
    "version",
    "_envops",
    "_exclude",
    "_tasks",
    "_answers_file",
    "_templates_suffix",
  ]);
  for (const c of candidates) {
    const p = path.join(templateDir, c);
    if (await exists(p)) {
      const txt = await fsp.readFile(p, "utf8").catch(() => "");
      for (const m of txt.matchAll(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(?:"[^"]*"|\S*)\s*$/gm)) {
        const key = m[1];
        if (!key.startsWith("_") && !reserved.has(key)) vars.push(key);
      }
      break;
    }
  }
  return Array.from(new Set(vars));
}

async function readAnswersMap(answersFile: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const txt = await fsp.readFile(answersFile, "utf8").catch(() => "");
  for (const m of txt.matchAll(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/gm)) {
    const k = m[1];
    const v = (m[2] || "").trim();
    if (!k.startsWith("_")) out[k] = v;
  }
  return out;
}

async function computeDefaultForKey(
  key: string,
  ctx: {
    targetDir: string;
    templateDir: string;
    answersMap: Record<string, string>;
    inoutData?: Record<string, any>;
  },
): Promise<string | undefined> {
  // Prefer an already-known value propagated via inoutData
  if (ctx.inoutData && typeof ctx.inoutData[key] === "string") return ctx.inoutData[key] as string;
  if (typeof ctx.answersMap[key] === "string" && ctx.answersMap[key]) return ctx.answersMap[key];
  // Common sensible defaults
  if (key === "name") return path.basename(ctx.targetDir);
  if (key === "language") {
    const parts = ctx.templateDir.split(path.sep);
    // tools/scaffolding/templates/<language>/<template>
    const idx = Math.max(0, parts.indexOf("templates"));
    const lang = parts[idx + 1];
    if (lang) return lang;
  }
  if (key === "template") {
    const parts = ctx.templateDir.split(path.sep);
    const idx = Math.max(0, parts.indexOf("templates"));
    const tmpl = parts[idx + 2];
    if (tmpl) return tmpl;
  }
  if (key === "lang_id") return path.basename(ctx.targetDir);
  if (key === "display_name") {
    const base = path.basename(ctx.targetDir);
    return base.charAt(0).toUpperCase() + base.slice(1);
  }
  if (key === "module") {
    try {
      const goModPath = path.join(ctx.targetDir, "go.mod");
      const txt = await fsp.readFile(goModPath, "utf8");
      const m = /^\s*module\s+(\S+)/m.exec(txt);
      if (m && m[1]) return m[1];
    } catch {}
    const base = path.basename(ctx.targetDir).replace(/[^a-zA-Z0-9._-]+/g, "-");
    return `example.com/local/${base}`;
  }
  if (key === "description") {
    const base = path.basename(ctx.targetDir).replace(/[^a-zA-Z0-9._-]+/g, "-");
    return `${base} library`;
  }
  if (key === "go_min") return "1.22";
  if (key === "license") return "MIT";
  if (key === "enable_ci") return "true";
  return undefined;
}

async function ensureTemplateVariables(
  targetDir: string,
  answersFile: string,
  templateDirFromAnswers?: string,
  inoutData?: Record<string, any>,
): Promise<void> {
  // Determine template dir
  let templateDir = templateDirFromAnswers || "";
  if (!templateDir) {
    const txt = await fsp.readFile(answersFile, "utf8").catch(() => "");
    templateDir = /^scaf_src_path:\s*(\S+)/m.exec(txt)?.[1]?.trim() || "";
  }
  if (!templateDir) return; // best-effort only
  const required = await readTemplateVars(templateDir);
  if (!required.length) return;
  const answersMap = await readAnswersMap(answersFile);
  const providedKeys = new Set<string>(Object.keys(answersMap));
  if (inoutData) {
    for (const k of Object.keys(inoutData)) providedKeys.add(k);
  }
  // Always consider these provided implicitly
  ["name", "language", "template", "scaf_src_path"].forEach((k) => providedKeys.add(k));
  const missing = required.filter((k) => !providedKeys.has(k));
  if (!missing.length) return;
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input, output });
    try {
      const scaffoldHint = path.relative(process.cwd(), targetDir) || targetDir;
      for (const key of missing) {
        const def = await computeDefaultForKey(key, {
          targetDir,
          templateDir,
          answersMap,
          inoutData,
        });
        let val = "";
        if (key === "enable_ci") {
          const ynPrompt = `[scaffold ${scaffoldHint}] Template requires variable "enable_ci" [Y/n]: `;
          const raw = (await rl.question(ynPrompt)).trim().toLowerCase();
          const defBool = (def || "true").toString().toLowerCase() !== "false";
          if (raw === "") {
            val = defBool ? "true" : "false";
            console.log(`→ using default for enable_ci: ${val}`);
          } else if (["y", "yes", "true", "1"].includes(raw)) {
            val = "true";
          } else if (["n", "no", "false", "0"].includes(raw)) {
            val = "false";
          } else {
            // Fallback: keep default when input is unrecognized
            val = defBool ? "true" : "false";
            console.log(`→ unrecognized input; using default for enable_ci: ${val}`);
          }
        } else {
          const prompt = def
            ? `[scaffold ${scaffoldHint}] Template requires variable "${key}" [${def}]: `
            : `[scaffold ${scaffoldHint}] Template requires variable "${key}": `;
          val = (await rl.question(prompt)).trim();
          if (!val && typeof def === "string" && def.length > 0) {
            val = def;
            console.log(`→ using default for ${key}: ${val}`);
          }
        }
        if (val) {
          if (inoutData) inoutData[key] = val;
          // Also persist into answers file so subsequent updates succeed
          const line = `\n${key}: ${val}\n`;
          await fsp.appendFile(answersFile, line, "utf8").catch(() => {});
        }
      }
    } finally {
      rl.close();
    }
    return;
  }
  // Non-interactive: try to auto-fill from sane defaults; if any remain unresolved, throw.
  const autofilled: string[] = [];
  const unresolved: string[] = [];
  for (const key of missing) {
    const def = await computeDefaultForKey(key, {
      targetDir,
      templateDir,
      answersMap,
      inoutData,
    });
    if (typeof def === "string" && def.length > 0) {
      const line = `\n${key}: ${def}\n`;
      await fsp.appendFile(answersFile, line, "utf8").catch(() => {});
      if (inoutData) inoutData[key] = def;
      autofilled.push(key);
    } else {
      unresolved.push(key);
    }
  }
  if (unresolved.length) {
    const list = unresolved.join(", ");
    const rel = path.relative(process.cwd(), path.join(targetDir, ".copier-answers.yml"));
    throw new Error(
      `Missing required template variables: ${list}.\n` +
        `Provide values by one of: (a) editing ${rel}, (b) re-running in an interactive terminal, or (c) passing --key=value to scaf.`,
    );
  }
  return;
}
