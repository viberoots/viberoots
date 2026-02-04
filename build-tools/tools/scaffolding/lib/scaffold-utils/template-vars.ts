import * as fsp from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

import { pathExists } from "../../../lib/repo.ts";

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
    if (await pathExists(p)) {
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
    // build-tools/tools/scaffolding/templates/<language>/<template>
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

export async function ensureTemplateVariables(
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
}
