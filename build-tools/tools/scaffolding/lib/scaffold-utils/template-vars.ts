import * as fsp from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

import {
  AUTO_INFERRED_KEYS,
  computeDefaultForKey,
  readAnswersMap,
  readTemplateVars,
  yamlScalar,
} from "./template-vars-helpers.ts";

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
        if (AUTO_INFERRED_KEYS.has(key) && typeof def === "string" && def.length > 0) {
          if (inoutData) inoutData[key] = def;
          const line = `\n${key}: ${yamlScalar(def)}\n`;
          await fsp.appendFile(answersFile, line, "utf8").catch(() => {});
          continue;
        }
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
          const line = `\n${key}: ${yamlScalar(val)}\n`;
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
      const line = `\n${key}: ${yamlScalar(def)}\n`;
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
