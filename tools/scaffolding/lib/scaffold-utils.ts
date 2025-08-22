#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import path from "node:path";
import os from "node:os";

export async function seedAnswersViaCopier(
  templateDir: string,
  targetDir: string,
  data: Record<string, any>,
) {
  await $`copier copy --trust --defaults --force --data-file ${await writeTempJson(data)} ${templateDir} ${targetDir}`;
}

export async function copierUpdate(targetDir: string) {
  const answers = path.join(targetDir, ".copier-answers.yml");
  if (await exists(answers)) {
    await $`copier update --trust --defaults --answers-file ${answers}`;
  } else {
    throw new Error("No .copier-answers.yml for update");
  }
}

export async function copierRecopyOrUpdate(targetDir: string) {
  try {
    await $`copier recopy --trust --defaults --force ${targetDir}`;
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
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "scaf-"));
  try {
    const answersJson = path.join(tmpDir, "answers.json");
    await fsp.writeFile(answersJson, JSON.stringify(data, null, 2), "utf8");
    await $`copier copy --trust --defaults --force --data-file ${answersJson} ${src} ${targetDir}`;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
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
