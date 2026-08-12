#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";

import { viberootsRoot, writeExecutable } from "./agent-wrapper-test-helpers.ts";
import {
  accountWrapper,
  accountWrapperFixture,
  cleanupAccountFixture,
  createApiKeyAccount,
  installCodexScript,
  type AccountWrapperFixture,
} from "./codex-wrapper.accounts-test-fixture.ts";

async function declaredPython(): Promise<string> {
  const root = String(process.env.VBR_ARTIFACT_TOOLS_ROOT || "");
  if (!root.startsWith("/nix/store/")) {
    throw new Error("canonical Nix artifact-tools root is unavailable in the test environment");
  }
  const candidate = path.join(root, "bin", "python3");
  fs.accessSync(candidate, fs.constants.X_OK);
  const real = await fsp.realpath(candidate);
  if (!real.startsWith("/nix/store/")) {
    throw new Error(`declared Python escaped the Nix store: ${real}`);
  }
  return candidate;
}

async function runInControllingTerminal(
  fixture: AccountWrapperFixture,
  command: string,
  input: string,
  opts: {
    innerTimeoutSeconds?: number;
    outerTimeoutMs?: number;
    timeoutStartPath?: string;
  } = {},
): Promise<{ code: number | null; output: string }> {
  const launcher = path.join(fixture.tmp, `terminal-${command}.sh`);
  const args =
    command === "init"
      ? "--account codex-account-new exec go"
      : command === "remove"
        ? "--remove-account codex-account-remove"
        : "--account codex-account-timeout login";
  await writeExecutable(
    launcher,
    `#!/usr/bin/env bash\nexec "$VBR_TEST_ACCOUNT_WRAPPER" ${args}\n`,
  );
  const env = { ...fixture.env };
  delete env.VBR_CODEX_NONINTERACTIVE;
  delete env.CODEX_ACCOUNT;
  delete env.CODEX_ACCOUNT_INIT;
  delete env.CODEX_ACCOUNT_REMOVE_YES;
  delete env.CODEX_HOME;
  delete env.VBR_CODEX_SAFEHOUSE_ACTIVE;
  delete env.VBR_CODEX_SAFEHOUSE_ROOT;
  const executable = await declaredPython();
  const ptyHarness = path.join(
    viberootsRoot,
    "build-tools/tools/tests/dev/codex-wrapper.accounts-terminal-harness.py",
  );
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, [ptyHarness], {
      cwd: fixture.gitRoot,
      env: {
        ...env,
        VBR_TEST_ACCOUNT_WRAPPER: accountWrapper,
        VBR_TEST_TERMINAL_LAUNCHER: launcher,
        VBR_TEST_TERMINAL_RESPONSES: input.trim().split(/\s+/).join(" "),
        VBR_TEST_TERMINAL_TIMEOUT_SECONDS: String(opts.innerTimeoutSeconds || 30),
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    let timedOut = false;
    let killFallback: NodeJS.Timeout | undefined;
    let timer: NodeJS.Timeout | undefined;
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    const armTimeout = () =>
      setTimeout(() => {
        timedOut = true;
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {}
        }
        killFallback = setTimeout(() => {
          if (!settled && child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {}
          }
        }, 2_000);
      }, opts.outerTimeoutMs || 40_000);
    if (opts.timeoutStartPath) {
      void (async () => {
        const deadline = Date.now() + 10_000;
        while (!settled && Date.now() < deadline) {
          const ready = await fsp
            .stat(opts.timeoutStartPath!)
            .then(() => true)
            .catch(() => false);
          if (ready) {
            timer = armTimeout();
            return;
          }
          await new Promise((done) => setTimeout(done, 20));
        }
        if (!settled) {
          timer = armTimeout();
        }
      })();
    } else {
      timer = armTimeout();
    }
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (killFallback) clearTimeout(killFallback);
      reject(error);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (killFallback) clearTimeout(killFallback);
      if (timedOut) {
        reject(new Error(`controlling-terminal ${command} prompt timed out\n${output}`));
      } else {
        resolve({ code, output });
      }
    });
  });
}

test("controlling-terminal guided creation handles decline and accepted login/default/reexec", async () => {
  const fixture = await accountWrapperFixture();
  try {
    await installCodexScript(
      fixture,
      `if [ "\${1:-}" = "login" ]; then
  mkdir -p "$CODEX_HOME"
  printf '%s\\n' '{"auth_mode":"apikey","OPENAI_API_KEY":"sk-test-only"}' > "$CODEX_HOME/auth.json"
fi
`,
    );
    const account = path.join(fixture.home, ".codex-accounts", "codex-account-new");
    const declined = await runInControllingTerminal(fixture, "init", "n\n");
    assert.equal(declined.code, 0, declined.output);
    await assert.rejects(fsp.stat(account), /ENOENT/);
    assert.equal(await fsp.readFile(fixture.log, "utf8").catch(() => ""), "");

    const accepted = await runInControllingTerminal(fixture, "init", "y\ny\n");
    assert.equal(accepted.code, 0, accepted.output);
    assert.equal(
      await fsp.realpath(path.join(fixture.home, ".codex-accounts", "default")),
      account,
    );
    const log = await fsp.readFile(fixture.log, "utf8");
    assert.equal((log.match(/^codex login$/gm) || []).length, 1);
    assert.equal((log.match(/^codex --sandbox danger-full-access exec go$/gm) || []).length, 1);
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

test("controlling-terminal removal handles decline and acceptance without hanging", async () => {
  const fixture = await accountWrapperFixture();
  try {
    const account = await createApiKeyAccount(fixture.home, "codex-account-remove");
    const declined = await runInControllingTerminal(fixture, "remove", "n\n");
    assert.equal(declined.code, 0, declined.output);
    assert.equal((await fsp.stat(account)).isDirectory(), true);

    const accepted = await runInControllingTerminal(fixture, "remove", "y\n");
    assert.equal(accepted.code, 0, accepted.output);
    await assert.rejects(fsp.stat(account), /ENOENT/);
  } finally {
    await cleanupAccountFixture(fixture);
  }
});

test("outer PTY timeout terminates descendants and releases the login lock", async () => {
  const fixture = await accountWrapperFixture();
  try {
    const account = await createApiKeyAccount(fixture.home, "codex-account-timeout");
    const pidFile = path.join(fixture.tmp, "login.pid");
    await installCodexScript(
      fixture,
      `if [ "\${1:-}" = "login" ]; then
  printf '%s' "$$" > ${JSON.stringify(pidFile)}
  trap 'exit 143' TERM INT
  while :; do sleep 0.1; done
fi
`,
    );
    await assert.rejects(
      runInControllingTerminal(fixture, "timeout", "", {
        // The harness timeout is only a final deadlock guard. Keep it well beyond
        // the outer timer so CPU starvation cannot make the harness win the race
        // and turn the expected timeout rejection into a successful exit.
        innerTimeoutSeconds: 120,
        outerTimeoutMs: 300,
        timeoutStartPath: pidFile,
      }),
      /timed out/,
    );
    await assert.rejects(fsp.stat(path.join(account, ".login.lock")), /ENOENT/);
    const pid = Number(await fsp.readFile(pidFile, "utf8"));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally {
    await cleanupAccountFixture(fixture);
  }
});
