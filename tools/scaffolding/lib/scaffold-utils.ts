#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";

export async function seedAnswersViaCopier(templateDir: string, targetDir: string, data: Record<string, any>) {
  await $`copier copy --trust --defaults --force --data ${JSON.stringify(data)} ${templateDir} ${targetDir}`;
}

export async function copierRecopyOrUpdate(targetDir: string) {
  try {
    await $`copier recopy --trust --defaults --force ${targetDir}`;
  } catch {
    const answers = path.join(targetDir, ".copier-answers.yml");
    if (await fs.pathExists(answers)) {
      await $`copier update --trust --defaults --answers-file ${answers}`;
    } else {
      throw new Error("No .copier-answers.yml for update");
    }
  }
}

export async function scaffoldOrUpdate(templateDir: string, targetDir: string, data: Record<string, any>) {
  if (await fs.pathExists(path.join(targetDir, ".copier-answers.yml"))) return copierRecopyOrUpdate(targetDir);
  await seedAnswersViaCopier(templateDir, targetDir, data);
}
