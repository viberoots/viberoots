import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import { ensureTemplateVariables } from "./template-vars";
import { pathExists } from "../../../lib/repo";
import { templateRootPath } from "../../scaf/templates/paths";

function workspaceRoot(): string {
  const envRoot = String(process.env.WORKSPACE_ROOT || process.env.BUCK_TEST_SRC || "").trim();
  if (envRoot) return path.resolve(envRoot);
  try {
    const out = execSync("git rev-parse --show-toplevel", {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    })
      .trim()
      .replace(/\r?\n/g, "");
    if (out) return out;
  } catch {}
  return path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "..",
    "..",
    "..",
  );
}

function toRepoAbsolute(inputPath: string): string {
  const root = workspaceRoot();
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(root, inputPath);
}

function toRepoRelativeIfPossible(inputPath: string): string {
  const root = workspaceRoot();
  const rel = path.relative(root, inputPath);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
  return inputPath;
}

function normalizeTemplateSource(raw: string): string {
  const src = String(raw || "").trim();
  if (!src) return "";
  if (src.endsWith("/copier.yaml") || src.endsWith("/copier.yml")) {
    return path.dirname(src);
  }
  return src;
}

async function templateSourceExists(src: string): Promise<boolean> {
  const resolved = toRepoAbsolute(src);
  try {
    const st = await fsp.stat(resolved);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function resolveTemplateSource(targetDir: string, answersFile: string): Promise<string> {
  const txt = await fsp.readFile(answersFile, "utf8");
  const fromRecorded = normalizeTemplateSource(
    /^scaf_src_path:\s*(\S+)/m.exec(txt)?.[1]?.trim() || "",
  );
  if (fromRecorded && (await templateSourceExists(fromRecorded))) return fromRecorded;
  if (fromRecorded.startsWith("build-tools/tools/scaffolding/templates/")) {
    const relocated = path.join("viberoots", fromRecorded);
    if (await templateSourceExists(relocated)) return relocated;
  }

  const language = /^language:\s*(\S+)/m.exec(txt)?.[1]?.trim() || "";
  const template = /^template:\s*(\S+)/m.exec(txt)?.[1]?.trim() || "";
  if (!language || !template) {
    throw new Error("scaf_src_path missing and language/template not present in answers");
  }
  const inferred = toRepoRelativeIfPossible(templateRootPath(language, template));
  if (await templateSourceExists(inferred)) return inferred;
  const legacyInferred = path.join(
    "build-tools",
    "tools",
    "scaffolding",
    "templates",
    language,
    template,
  );
  if (await templateSourceExists(legacyInferred)) return legacyInferred;

  throw new Error(
    `cannot resolve scaffold template source for ${targetDir}; tried '${fromRecorded || "(none)"}', '${inferred}', and '${legacyInferred}'`,
  );
}

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
  const targetAbs = toRepoAbsolute(targetDir);
  const answersAbs = path.join(targetAbs, ".copier-answers.yml");
  if (await pathExists(answersAbs)) {
    await ensureTemplateVariables(targetAbs, answersAbs);
    await runCopierFiltered([
      "update",
      "--trust",
      "--defaults",
      "--answers-file",
      toRepoRelativeIfPossible(answersAbs),
    ]);
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
  const targetAbs = toRepoAbsolute(targetDir);
  const answersFile = path.join(targetAbs, ".copier-answers.yml");
  if (!(await pathExists(answersFile))) {
    throw new Error("answers file missing");
  }
  const src = toRepoAbsolute(await resolveTemplateSource(targetDir, answersFile));
  const txt = await fsp.readFile(answersFile, "utf8");
  const name = /^name:\s*(\S+)/m.exec(txt)?.[1]?.trim() || path.basename(targetDir);
  const language = /^language:\s*(\S+)/m.exec(txt)?.[1]?.trim() || "";
  const template = /^template:\s*(\S+)/m.exec(txt)?.[1]?.trim() || "";
  const data = { name, language, template } as Record<string, any>;

  await ensureTemplateVariables(targetAbs, answersFile, src, data);

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
      toRepoRelativeIfPossible(answersFile),
      "--data-file",
      answersJson,
      src,
      targetAbs,
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
  const res = await $({ stdio: "pipe", cwd: workspaceRoot() })`copier ${args}`.nothrow();
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
