import * as fsp from "node:fs/promises";
import path from "node:path";
import { externalScratchRoot, writeExecutable } from "./agent-wrapper-test-helpers";

export async function prepareStaleCodexShell(tmp: string, wrapper: string) {
  const sourceRoot = path.join(tmp, "source");
  const wrapperDir = path.join(sourceRoot, "build-tools", "tools", "bin");
  const wrapperCopy = path.join(wrapperDir, "codex");
  const sourceBin = path.join(sourceRoot, "node_modules", ".bin");
  const staleNodeModules = path.join(tmp, "stale-node", "node_modules");
  const staleBin = path.join(staleNodeModules, ".bin");
  const log = path.join(tmp, "calls.log");
  await Promise.all([
    fsp.mkdir(wrapperDir, { recursive: true }),
    fsp.mkdir(sourceBin, { recursive: true }),
    fsp.mkdir(staleBin, { recursive: true }),
  ]);
  await fsp.copyFile(wrapper, wrapperCopy);
  await fsp.chmod(wrapperCopy, 0o755);
  await writeExecutable(
    path.join(sourceBin, "codex"),
    `#!/usr/bin/env bash\nprintf 'source-managed-codex %s\\n' "$*" >> ${JSON.stringify(log)}\n`,
  );
  await writeExecutable(
    path.join(staleBin, "codex"),
    `#!/usr/bin/env bash\nprintf 'node-path-codex %s\\n' "$*" >> ${JSON.stringify(log)}\n`,
  );
  return { log, sourceBin, sourceRoot, staleNodeModules, wrapperCopy, wrapperDir };
}

export function managedCodexEnv(bin: string): Record<string, string> {
  return {
    CODEX_CLI_PATH: "",
    VBR_CODEX_MANAGED_PATH_FOR_TEST: path.join(bin, "codex"),
  };
}

export async function withCodexScratch(
  fn: (context: { tmp: string }) => Promise<void>,
): Promise<void> {
  await fsp.mkdir(externalScratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(externalScratchRoot, "codex-wrapper-"));
  try {
    await fn({ tmp });
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

export async function withCodexRepoScratch(
  fn: (context: { tmp: string; gitRoot: string }) => Promise<void>,
): Promise<void> {
  await withCodexScratch(async ({ tmp }) => {
    const gitRoot = path.join(tmp, "repo");
    await fsp.mkdir(gitRoot, { recursive: true });
    await fn({ tmp, gitRoot });
  });
}
