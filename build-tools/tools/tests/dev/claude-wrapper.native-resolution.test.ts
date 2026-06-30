#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { binWrapper, repoRoot, scratchRoot } from "./agent-wrapper-test-helpers.ts";

const wrapper = binWrapper("claude");

async function writeExecutable(file: string, text: string): Promise<void> {
  await fsp.writeFile(file, text, "utf8");
  await fsp.chmod(file, 0o755);
}

test("claude wrapper resolves native optional package binaries for supported platforms", async () => {
  for (const platform of [
    "darwin-arm64",
    "darwin-x64",
    "linux-x64",
    "linux-arm64",
    "linux-x64-musl",
    "linux-arm64-musl",
  ]) {
    await fsp.mkdir(scratchRoot, { recursive: true });
    const tmp = await fsp.mkdtemp(path.join(scratchRoot, "claude-native-"));
    try {
      const bin = path.join(tmp, "node_modules", ".bin");
      const nativeDir = path.join(
        tmp,
        "node_modules",
        ".pnpm",
        `@anthropic-ai+claude-code-${platform}@2.1.128`,
        "node_modules",
        "@anthropic-ai",
        `claude-code-${platform}`,
      );
      await fsp.mkdir(bin, { recursive: true });
      await fsp.mkdir(nativeDir, { recursive: true });
      await writeExecutable(
        path.join(bin, "claude"),
        `#!/usr/bin/env bash
echo stub should not run
exit 99
`,
      );
      await writeExecutable(
        path.join(nativeDir, "claude"),
        `#!/usr/bin/env bash
printf 'native %s\\n' "${platform}"
`,
      );

      const res = await $({
        cwd: tmp,
        stdio: "pipe",
        env: {
          ...process.env,
          PATH: `${path.dirname(wrapper)}:${bin}:/usr/bin:/bin`,
          VBR_CLAUDE_PLATFORM_KEY_FOR_TEST: platform,
          VBR_CLAUDE_SAFEHOUSE: "0",
        },
      })`${wrapper} --version`;

      assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
      assert.equal(String(res.stdout).trim(), `native ${platform}`);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  }
});

test("claude wrapper skips cmux delegate wrapper when cmux delegates back to viberoots", async () => {
  await fsp.mkdir(scratchRoot, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(scratchRoot, "claude-cmux-"));
  try {
    const cmuxBin = path.join(tmp, "cmux", "bin");
    const realBin = path.join(tmp, "real-bin");
    await fsp.mkdir(cmuxBin, { recursive: true });
    await fsp.mkdir(realBin, { recursive: true });
    await writeExecutable(
      path.join(cmuxBin, "claude"),
      `#!/usr/bin/env bash
# cmux claude wrapper - test fixture
echo cmux wrapper should not be selected
exit 99
`,
    );
    await writeExecutable(
      path.join(cmuxBin, "cmux"),
      `#!/usr/bin/env bash
exit 0
`,
    );
    await writeExecutable(
      path.join(realBin, "claude"),
      `#!/usr/bin/env bash
printf 'real-claude %s\\n' "$*"
`,
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        PATH: `${path.dirname(wrapper)}:${cmuxBin}:${realBin}:/usr/bin:/bin`,
        CMUX_SHELL_INTEGRATION_DIR: "",
        VBR_CLAUDE_SAFEHOUSE: "0",
      },
    })`${wrapper} --version`;

    assert.equal(res.exitCode, 0, String(res.stderr || res.stdout));
    assert.equal(String(res.stdout).trim(), "real-claude --version");
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
