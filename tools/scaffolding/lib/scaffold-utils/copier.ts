import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ensureTemplateVariables } from "./template-vars.ts";
import { pathExists } from "../../../lib/repo.ts";

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
  if (await pathExists(answers)) {
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
  if (!(await pathExists(answersFile))) {
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
    await removeTempDirBestEffort(tmpDir);
  }
}

export async function scaffoldOrUpdate(
  templateDir: string,
  targetDir: string,
  data: Record<string, any>,
) {
  if (await pathExists(path.join(targetDir, ".copier-answers.yml"))) {
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

async function removeTempDirBestEffort(tmpDir: string): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch((err) => {
      console.warn("warning: failed to remove temp dir:", err);
    });
  }
}
