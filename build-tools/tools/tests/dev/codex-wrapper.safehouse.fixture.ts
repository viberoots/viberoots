import * as fsp from "node:fs/promises";
import path from "node:path";
import { externalScratchRoot, viberootsRoot, writeExecutable } from "./agent-wrapper-test-helpers";
import { sanitizedAccountWrapperEnv } from "./codex-wrapper.accounts-test-fixture.ts";

async function pathTool(name: string): Promise<string> {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(dir, name);
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(`${name} is unavailable in the test environment`);
}

export async function isolatedCodexAccountEnv(tmp: string): Promise<NodeJS.ProcessEnv> {
  const home = path.join(tmp, "home");
  const legacy = path.join(home, ".codex");
  await fsp.mkdir(legacy, { recursive: true });
  await fsp.writeFile(
    path.join(legacy, "auth.json"),
    JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-safehouse-fixture-only" }),
  );
  return sanitizedAccountWrapperEnv({
    HOME: home,
    XDG_CACHE_HOME: path.join(tmp, "cache"),
  });
}

export async function prepareStaleCodexShell(tmp: string, wrapper: string) {
  const sourceRoot = path.join(tmp, "source");
  const wrapperDir = path.join(sourceRoot, "build-tools", "tools", "bin");
  const wrapperCopy = path.join(wrapperDir, "codex");
  const sourceBin = path.join(sourceRoot, "node_modules", ".bin");
  const sourceDev = path.join(sourceRoot, "build-tools", "tools", "dev");
  const sourceLib = path.join(sourceRoot, "build-tools", "tools", "lib");
  const staleNodeModules = path.join(tmp, "stale-node", "node_modules");
  const staleBin = path.join(staleNodeModules, ".bin");
  const log = path.join(tmp, "calls.log");
  const zxWrapper = await pathTool("zx-wrapper");
  await Promise.all([
    fsp.mkdir(wrapperDir, { recursive: true }),
    fsp.mkdir(sourceBin, { recursive: true }),
    fsp.mkdir(sourceDev, { recursive: true }),
    fsp.mkdir(sourceLib, { recursive: true }),
    fsp.mkdir(staleBin, { recursive: true }),
  ]);
  await Promise.all([
    fsp.cp(
      path.join(viberootsRoot, "build-tools", "tools", "dev", "codex-accounts"),
      path.join(sourceDev, "codex-accounts"),
      { recursive: true },
    ),
    fsp.copyFile(
      path.join(viberootsRoot, "build-tools", "tools", "dev", "codex-accounts.ts"),
      path.join(sourceDev, "codex-accounts.ts"),
    ),
    fsp.copyFile(
      path.join(viberootsRoot, "build-tools", "tools", "dev", "zx-init.mjs"),
      path.join(sourceDev, "zx-init.mjs"),
    ),
    ...["argv.ts", "cli.ts", "cli-wrap.ts", "errors.ts", "terminal-select.ts"].map((file) =>
      fsp.copyFile(
        path.join(viberootsRoot, "build-tools", "tools", "lib", file),
        path.join(sourceLib, file),
      ),
    ),
  ]);
  await fsp.copyFile(wrapper, wrapperCopy);
  await fsp.chmod(wrapperCopy, 0o755);
  await fsp.copyFile(zxWrapper, path.join(sourceBin, "zx-wrapper"));
  await fsp.chmod(path.join(sourceBin, "zx-wrapper"), 0o755);
  await writeExecutable(
    path.join(sourceBin, "codex"),
    `#!/usr/bin/env bash
printf 'source-managed-codex %s\\n' "$*" >> ${JSON.stringify(log)}
printf 'CODEX_HOME=%s\\n' "\${CODEX_HOME:-}" >> ${JSON.stringify(log)}
`,
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
