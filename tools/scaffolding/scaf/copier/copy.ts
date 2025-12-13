import os from "node:os";
import path from "node:path";

import * as fsp from "node:fs/promises";

export async function runCopierCopy(templateDir: string, dest: string, data: Record<string, any>) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "scaf-"));
  const answersPath = path.join(tmpDir, "answers.json");
  await fsp.writeFile(answersPath, JSON.stringify(data, null, 2), "utf8");
  try {
    const absTemplate = path.resolve(templateDir);
    const absDest = path.resolve(dest);
    await fsp.mkdir(absDest, { recursive: true });
    await $`copier copy --trust --defaults --force --data-file ${answersPath} ${absTemplate} ${absDest}`;
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
