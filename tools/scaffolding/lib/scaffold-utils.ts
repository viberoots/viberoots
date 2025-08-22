#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";

export async function seedAnswersViaCopier(templateDir: string, targetDir: string, data: Record<string, any>) {
  await $`copier copy --trust --defaults --force --data-file ${writeTempJson(data)} ${templateDir} ${targetDir}`;
}

export async function copierUpdate(targetDir: string) {
  const answers = path.join(targetDir, ".copier-answers.yml");
  if (await fs.pathExists(answers)) {
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
  if (!(await fs.pathExists(answersFile))) throw new Error("answers file missing");
  const txt = await fs.readFile(answersFile, "utf8");
  const src = /scaf_src_path:\s*(.*)\s*$/.exec(txt)?.[1]?.trim();
  if (!src) throw new Error("scaf_src_path not recorded in answers");
  const name = /name:\s*(.*)\s*$/.exec(txt)?.[1]?.trim() || path.basename(targetDir);
  const language = /language:\s*(.*)\s*$/.exec(txt)?.[1]?.trim() || "";
  const template = /template:\s*(.*)\s*$/.exec(txt)?.[1]?.trim() || "";
  const data = { name, language, template } as Record<string, any>;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scaf-"));
  try {
    const answersJson = path.join(tmpDir, "answers.json");
    await fs.writeFile(answersJson, JSON.stringify(data, null, 2), "utf8");
    await $`copier copy --trust --defaults --force --data-file ${answersJson} ${src} ${targetDir}`;
  } finally {
    await fs.remove(tmpDir).catch(() => {});
  }
}

export async function scaffoldOrUpdate(templateDir: string, targetDir: string, data: Record<string, any>) {
  if (await fs.pathExists(path.join(targetDir, ".copier-answers.yml"))) return copierRecopyOrUpdate(targetDir);
  await seedAnswersViaCopier(templateDir, targetDir, data);
}

function writeTempJson(obj: any): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scaf-"));
  const p = path.join(tmpDir, "answers.json");
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
  return p;
}
