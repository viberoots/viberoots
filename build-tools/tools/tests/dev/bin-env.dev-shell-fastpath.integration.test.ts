#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const execFileAsync = promisify(execFileCb);

async function readRepoFile(rel: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(rel), "utf8");
}

test("devshell.sh supports safe direnv bypass fast-path", async () => {
  const txt = [
    await readRepoFile("build-tools/tools/bin/devshell.sh"),
    await readRepoFile("build-tools/tools/bin/devshell-workspace.sh"),
  ].join("\n");
  if (!txt.includes("BUCK_DEV_SHELL_FASTPATH")) {
    throw new Error("devshell.sh must expose BUCK_DEV_SHELL_FASTPATH toggle");
  }
  if (!txt.includes("can_bypass_direnv")) {
    throw new Error("devshell.sh must compute explicit direnv bypass eligibility");
  }
  if (
    !txt.includes("devshell_inputs_stale") ||
    !txt.includes("devshell_stale_reload_allowed") ||
    !txt.includes(".source-fingerprint") ||
    !txt.includes('find "${live_root}/viberoots" -type f -newer "${marker}"') ||
    !txt.includes("-not -path '*/buck-out/*'") ||
    !txt.includes("re-running this command through direnv exec") ||
    !txt.includes("VBR_DEVSHELL_STALE_RELOAD_ATTEMPTED=1") ||
    !txt.includes('exec direnv exec "$live_root" "$@"')
  ) {
    throw new Error("devshell.sh fast-path must fall back through direnv for stale shell inputs");
  }
  for (const envName of [
    "BUCK_TEST_TARGET",
    "BUCK_TEST_SRC",
    "VBR_VERIFY_LOG_FILE",
    "VBR_VERIFY_PROCESS_STATE_FILE",
    "VBR_TEST_SEED_STORE_PATH",
    "VBR_RUN_IN_TEMP_REPO",
  ]) {
    if (!txt.includes(`[[ -z "\${${envName}:-}" ]] || return 1`)) {
      throw new Error(`devshell.sh stale direnv reload must be disabled when ${envName} is set`);
    }
  }
  const execInDevShell = txt.slice(txt.indexOf("exec_in_dev_shell()"));
  if (
    execInDevShell.indexOf("devshell_stale_reload_allowed") >
    execInDevShell.indexOf("devshell_inputs_stale")
  ) {
    throw new Error("devshell.sh must check stale reload eligibility before stale inputs");
  }
  if (
    execInDevShell.indexOf("devshell_inputs_stale") > execInDevShell.indexOf("ensure_buck_prelude")
  ) {
    throw new Error("devshell.sh must reload stale shell inputs before materializing prelude");
  }
  if (
    !txt.includes("for tool in zx-wrapper nix buck2 pnpm git") ||
    !txt.includes('[[ "${missing}" == "0" && -f "${zx_init_path}" ]]')
  ) {
    throw new Error("devshell.sh fast-path must require core toolchain and zx-init to be present");
  }
  if (!txt.includes('BUCK_CONFIG_LOCK=1 exec "$@"')) {
    throw new Error("devshell.sh fast-path must preserve BUCK_CONFIG_LOCK on direct exec");
  }
  if (
    !txt.includes(
      '[[ ! -f "${cwd_source_root}/build-tools/tools/dev/viberoots.ts" && -f "${cwd_root}/viberoots/build-tools/tools/dev/viberoots.ts" ]]',
    ) ||
    !txt.includes(
      '[[ -f "${cwd_source_root}/build-tools/tools/dev/viberoots.ts" && -x "${cwd_tool}" ]]',
    )
  ) {
    throw new Error(
      "devshell.sh must re-exec source-owned build-tools before stale generated authority",
    );
  }
  if (
    !txt.includes('local prelude_path="${live_root}/.viberoots/workspace/prelude"') ||
    !txt.includes('[[ -f "${prelude_path}/prelude.bzl" ]]') ||
    !txt.includes("ensure_viberoots_current") ||
    !txt.includes('target=".."') ||
    !txt.includes('current_is_live_root="1"') ||
    !txt.includes('[[ "${current_is_live_root}" != "1" && -L "${live_root}/prelude" ]]') ||
    !txt.includes('rm -f "${live_root}/prelude"') ||
    txt.includes('[[ -f "${live_root}/prelude/prelude.bzl" ]]')
  ) {
    throw new Error(
      "devshell.sh must activate .viberoots/current and not materialize root prelude in extracted workspaces",
    );
  }
  if (
    !txt.includes('local selected_viberoots_input_root="${VIBEROOTS_FLAKE_INPUT_ROOT:-') ||
    !txt.includes('! -f "${selected_viberoots_input_root}/flake.nix"') ||
    !txt.includes('export VIBEROOTS_FLAKE_INPUT_ROOT="${selected_viberoots_input_root}"') ||
    !txt.includes('VIBEROOTS_SOURCE_ROOT="${active_viberoots_root}"') ||
    !txt.includes('VIBEROOTS_FLAKE_INPUT_ROOT="${selected_viberoots_input_root}" nix build') ||
    !txt.includes('--override-input viberoots "path:${selected_viberoots_input_root}"') ||
    !txt.includes("selected_viberoots_input_hash")
  ) {
    throw new Error(
      "devshell.sh prelude materialization must override and cache by the selected viberoots flake input root",
    );
  }
});

test("stale generated wrappers re-exec the consumer's source-owned command", async () => {
  const source = await readRepoFile("build-tools/tools/bin/devshell.sh");
  const start = source.indexOf("env_reexec_from_cwd_repo() {");
  const end = source.indexOf("\nenv_init_paths() {", start);
  const fn = source.slice(start, end);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-devshell-source-reexec-"));
  try {
    const staleBin = path.join(root, "stale/build-tools/tools/bin");
    const sourceBin = path.join(root, "consumer/viberoots/build-tools/tools/bin");
    const fakeBin = path.join(root, "fake-bin");
    await Promise.all([
      fsp.mkdir(staleBin, { recursive: true }),
      fsp.mkdir(sourceBin, { recursive: true }),
      fsp.mkdir(path.join(root, "consumer/viberoots/build-tools/tools/dev"), {
        recursive: true,
      }),
      fsp.mkdir(fakeBin, { recursive: true }),
    ]);
    await fsp.writeFile(
      path.join(sourceBin, "u"),
      "#!/usr/bin/env bash\nprintf 'source-owned\\n'\n",
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(root, "consumer/viberoots/build-tools/tools/dev/viberoots.ts"),
      "",
    );
    await fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash\nprintf '%s\\n' ${JSON.stringify(path.join(root, "consumer"))}\n`,
      { mode: 0o755 },
    );
    const { stdout } = await execFileAsync(
      "/bin/bash",
      [
        "-c",
        `${fn}\nexport ENV_SH_DIR="$1" PATH="$2:/usr/bin:/bin"; cd "$3"; env_reexec_from_cwd_repo`,
        "u",
        staleBin,
        fakeBin,
        path.join(root, "consumer"),
      ],
      { env: process.env },
    );
    if (stdout !== "source-owned\n") {
      throw new Error(`expected source-owned wrapper re-exec, got ${JSON.stringify(stdout)}`);
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("devshell stale detection rejects divergent local and filtered source identities", async () => {
  const source = await readRepoFile("build-tools/tools/bin/devshell-workspace.sh");
  const start = source.indexOf("devshell_inputs_stale() {");
  const end = source.indexOf("\ndevshell_stale_reload_allowed() {", start);
  const fn = source.slice(start, end);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-devshell-source-identity-"));
  try {
    const localFile = path.join(root, "viberoots", "build-tools", "lang", "nix_shell.bzl");
    const marker = path.join(
      root,
      ".viberoots",
      "workspace",
      "viberoots-flake-input",
      ".source-fingerprint",
    );
    await fsp.mkdir(path.dirname(localFile), { recursive: true });
    await fsp.mkdir(path.dirname(marker), { recursive: true });
    await fsp.writeFile(localFile, "identity-a\n");
    await fsp.writeFile(marker, "");
    const old = new Date(Date.now() - 10_000);
    const fresh = new Date(Date.now() + 10_000);
    await fsp.utimes(localFile, old, old);
    await fsp.utimes(marker, new Date(), new Date());
    await assertRejectsExit(fn, root, 1);
    await fsp.writeFile(localFile, "identity-b\n");
    await fsp.utimes(localFile, fresh, fresh);
    await assertRejectsExit(fn, root, 0);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

async function assertRejectsExit(fn: string, root: string, expected: number): Promise<void> {
  const result = await execFileAsync(
    "/bin/bash",
    ["-c", `${fn}\ndevshell_inputs_stale "$1"`, "devshell-stale-test", root],
    { env: process.env },
  ).then(
    () => 0,
    (error: NodeJS.ErrnoException) => Number(error.code),
  );
  if (result !== expected) {
    throw new Error(`expected stale detection exit ${expected}, got ${result}`);
  }
}
