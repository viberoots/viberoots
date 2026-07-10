#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { initConsumer } from "../../lib/consumer-bootstrap";

const execFileAsync = promisify(execFile);

async function findViberootsRoot(): Promise<string> {
  for (const candidate of [path.join(process.cwd(), "viberoots"), process.cwd()]) {
    try {
      await fsp.access(path.join(candidate, "init"));
      await fsp.access(path.join(candidate, "build-tools", "tools", "bin", "viberoots"));
      return candidate;
    } catch {}
  }
  throw new Error("could not find viberoots root");
}

async function assertDirenvBootstrap(workspace: string): Promise<void> {
  const envrc = await fsp.readFile(path.join(workspace, ".envrc"), "utf8");
  assert.match(envrc, /\.viberoots\/bootstrap\/direnv-stage0\.sh/);
  assert.match(envrc, /source "\$\{__vbr_stage0\}"/);
  assert.doesNotMatch(envrc, /use flake/);

  const stage0 = await fsp.readFile(
    path.join(workspace, ".viberoots", "bootstrap", "direnv-stage0.sh"),
    "utf8",
  );
  assert.match(
    stage0,
    /use flake "path:\$\{PWD\}\/\.viberoots\/workspace#default" --accept-flake-config --no-write-lock-file "\$\{__vbr_flake_args\[@\]\}"/,
  );
  assert.match(stage0, /if \[\[ "\$\{NIX_PNPM_ALLOW_GENERATE:-\}" == "1" \]\]/);
  assert.match(stage0, /__vbr_flake_args\+=\(--impure\)/);
  assert.match(stage0, /! -f "\$\{__vbr_flake_input_root\}\/flake\.nix"/);
  assert.match(
    stage0,
    /__vbr_current_real="\$\(cd "\$\{PWD\}\/\.viberoots\/current" && pwd -P 2>\/dev\/null \|\| true\)"/,
  );
  assert.match(
    stage0,
    /__vbr_local_real="\$\(cd "\$\{PWD\}\/viberoots" && pwd -P 2>\/dev\/null \|\| true\)"/,
  );
  assert.match(stage0, /"\$\{__vbr_current_real\}" == "\$\{__vbr_local_real\}"/);
  assert.match(stage0, /__vbr_flake_input_is_generated_filtered=0/);
  assert.match(stage0, /__vbr_flake_input_is_generated_filtered=1/);
  assert.match(stage0, /if \[\[ "\$\{__vbr_flake_input_is_generated_filtered\}" == "1" \]\]/);
  assert.match(stage0, /__vbr_flake_args=\(\)/);
  assert.match(
    stage0,
    /__vbr_flake_args=\(--override-input viberoots "path:\$\{__vbr_flake_input_root\}"\)/,
  );
  assert.match(stage0, /__vbr_stage0_filtered_viberoots_input\(\)/);
  assert.match(stage0, /__vbr_stage0_align_workspace_flake_input\(\)/);
  assert.match(stage0, /viberoots-flake-input/);
  assert.match(stage0, /export VIBEROOTS_SOURCE_ROOT="\$\{__vbr_source_root\}"/);
  assert.match(stage0, /__vbr_current_real.*__vbr_filtered_real/s);
  assert.match(stage0, /__vbr_input_real.*__vbr_filtered_real/s);
  assert.match(stage0, /__vbr_flake_input_root="\$\{PWD\}\/viberoots"/);
  assert.match(stage0, /readlink "\$\{PWD\}\/\.viberoots\/current"/);
  assert.match(stage0, /!= "\.\.\/viberoots"/);
  assert.match(stage0, /rm -f "\$\{PWD\}\/\.viberoots\/current" && ln -s \.\.\/viberoots/);
  for (const excluded of [
    "--exclude /.viberoots",
    "--exclude /node_modules",
    "--exclude /buck-out",
    "--exclude /.direnv",
  ]) {
    assert.match(stage0, new RegExp(excluded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(stage0, /__vbr_stage0_apply_nix_cache_health \|\| return 1/);
  assert.match(stage0, /error: viberoots workspace flake is missing\./);
  assert.match(stage0, /run: viberoots bootstrap-check --repair-if-needed/);
}

async function withConsumerWorkspace(
  prefix: string,
  fn: (workspace: string, viberootsRoot: string) => Promise<void>,
): Promise<void> {
  const tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`)));
  try {
    const viberootsRoot = await findViberootsRoot();
    await fsp.symlink(viberootsRoot, path.join(tmp, "viberoots"));
    await fn(tmp, viberootsRoot);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

test("viberoots/init bootstraps and can install a bare consumer workspace", async () => {
  await withConsumerWorkspace("viberoots-init-consumer", async (workspace) => {
    const fakeBin = path.join(workspace, ".fake-bin");
    const fakeHome = path.join(workspace, ".fake-home");
    const direnvLog = path.join(workspace, ".direnv.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.mkdir(path.join(fakeHome, ".nix-profile", "share", "nix-direnv"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(fakeHome, ".nix-profile", "share", "nix-direnv", "direnvrc"),
      "",
      "utf8",
    );
    await fsp.writeFile(
      path.join(fakeBin, "direnv"),
      `#!/usr/bin/env bash\nif [[ "\${1:-}" == "--version" ]]; then exit 0; fi\nprintf 'NIX_PNPM_ALLOW_GENERATE=%s %s\\n' "\${NIX_PNPM_ALLOW_GENERATE:-}" "$*" >> ${JSON.stringify(direnvLog)}\n`,
      { mode: 0o755 },
    );

    const { stdout, stderr } = await execFileAsync(
      path.join(workspace, "viberoots", "init"),
      ["--run-install"],
      {
        cwd: workspace,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
          HOME: fakeHome,
          NO_DEV_SHELL: "1",
          VBR_INIT_USE_LOCAL_COMMAND: "1",
        },
      },
    );

    assert.match(stdout, /ok\s+workspace initialized/);
    assert.equal(stderr, "");
    const direnvText = await fsp.readFile(direnvLog, "utf8");
    assert.match(direnvText, /NIX_PNPM_ALLOW_GENERATE=1 allow /);
    assert.match(direnvText, /NIX_PNPM_ALLOW_GENERATE=1 exec .* i/);
    assert.equal(await fsp.readlink(path.join(workspace, ".viberoots", "current")), "../viberoots");
    assert.equal(
      (await fsp.stat(path.join(workspace, ".viberoots", "workspace"))).isDirectory(),
      true,
    );
    assert.equal((await fsp.stat(path.join(workspace, "projects"))).isDirectory(), true);
    assert.equal(
      (await fsp.stat(path.join(workspace, ".viberoots", "workspace", "buck"))).isDirectory(),
      true,
    );
    assert.equal(
      await fsp.readlink(path.join(workspace, ".viberoots", "workspace", "buck")),
      "../buck",
    );
    assert.equal(await fsp.readFile(path.join(workspace, ".buckroot"), "utf8"), ".\n");
    const buckconfig = await fsp.readFile(path.join(workspace, ".buckconfig"), "utf8");
    assert.match(buckconfig, /\.viberoots\/current\/prelude/);
    assert.doesNotMatch(buckconfig, /\.viberoots\/workspace\/prelude/);
    assert.match(buckconfig, /^ignore = .*\.git/m);
    assert.match(buckconfig, /^ignore = .*\.direnv/m);
    await assertDirenvBootstrap(workspace);
    assert.match(
      await fsp.readFile(path.join(workspace, "flake.nix"), "utf8"),
      /if root != "" then builtins\.toPath root else \.\/\.;/,
    );
    await assert.rejects(fsp.lstat(path.join(workspace, "buck-out")));
    assert.match(
      await fsp.readFile(path.join(workspace, ".viberoots", "workspace", "flake.nix"), "utf8"),
      /path:\.\/viberoots-flake-input/,
    );
    assert.match(
      await fsp.readFile(path.join(workspace, ".viberoots", "workspace", "flake.nix"), "utf8"),
      /builtins\.getEnv "WORKSPACE_ROOT"/,
    );
    const readme = await fsp.readFile(path.join(workspace, "README.md"), "utf8");
    assert.match(readme, /viberoots\/README\.md/);
    assert.match(readme, /Existing Checkout \/ New Workstation/);
    assert.match(readme, /Use viberoots' post-clone script/);
    assert.match(readme, /repairs local ignored workspace state from the checked-in lock/);
    assert.match(readme, /runs the initial\s+install step/);
    assert.match(readme, /does not advance the pinned viberoots input/);
    assert.match(readme, /curl -fsSL https:\/\/viberoots\.dev\/post-clone \| bash/);
    assert.match(readme, /b && v/);
    assert.match(
      await fsp.readFile(path.join(workspace, "projects", "README.md"), "utf8"),
      /Project and application source/,
    );
    const agentNotes = await fsp.readFile(path.join(workspace, "projects", "AGENTS.md"), "utf8");
    assert.match(agentNotes, /shared repository tooling/);
    assert.match(agentNotes, /Do not install repository tools manually/);
    assert.match(agentNotes, /\.\.\/viberoots\/README\.md/);
    assert.match(agentNotes, /\.\.\/\.viberoots\/current\/docs\/README\.md/);
    assert.match(
      await fsp.readFile(path.join(workspace, "projects", "config", "shared.json"), "utf8"),
      /"schemaVersion": "viberoots-project-config@1"/,
    );
    assert.match(
      await fsp.readFile(path.join(workspace, "projects", "config", "local.json"), "utf8"),
      /"schemaVersion": "viberoots-project-local-config@1"/,
    );
    const configReadme = await fsp.readFile(
      path.join(workspace, "projects", "config", "README.md"),
      "utf8",
    );
    assert.match(configReadme, /\.viberoots\/current\/docs\/sprinkleref\.md/);
    assert.match(configReadme, /Use `shared\.json` for checked-in, non-secret values/);
    assert.match(configReadme, /Use `local\.json` for gitignored, per-operator values/);
    assert.match(configReadme, /Use `secret:\/\/\.\.\.` refs for true secrets/);
    assert.match(configReadme, /sprinkleref --update secret:\/\/path\/to\/secret --create-missing/);
    const gitignore = await fsp.readFile(path.join(workspace, ".gitignore"), "utf8");
    assert.match(gitignore, /\.viberoots\//);
    assert.match(gitignore, /buck-out\//);
    assert.match(gitignore, /\.direnv\//);
    assert.match(gitignore, /\.nix-zsh\//);
    assert.match(gitignore, /\.nix-gcroots\//);
    assert.match(gitignore, /^node_modules$/m);
    assert.match(gitignore, /node_modules\//);
    assert.match(gitignore, /projects\/config\/local\.json/);
    if (process.platform === "darwin") {
      await fsp.stat(path.join(workspace, ".metadata_never_index"));
    }
    assert.equal(
      await fsp.readFile(direnvLog, "utf8"),
      `NIX_PNPM_ALLOW_GENERATE=1 allow ${workspace}\nNIX_PNPM_ALLOW_GENERATE=1 exec ${workspace} i\n`,
    );
    await fsp.writeFile(direnvLog, "", "utf8");
    await execFileAsync(path.join(workspace, "viberoots", "init"), ["--run-install"], {
      cwd: workspace,
      env: {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
        HOME: fakeHome,
        NO_DEV_SHELL: "1",
        VBR_INIT_USE_LOCAL_COMMAND: "1",
      },
    });
    assert.equal(
      await fsp.readFile(direnvLog, "utf8"),
      `NIX_PNPM_ALLOW_GENERATE= allow ${workspace}\nNIX_PNPM_ALLOW_GENERATE= exec ${workspace} i\n`,
    );
    assert.deepEqual(await visibleRootEntries(workspace), [
      "README.md",
      "flake.nix",
      "projects",
      "viberoots",
    ]);
  });
});

test("viberoots/init reports install failure without buffered direnv command dump", async () => {
  await withConsumerWorkspace("viberoots-init-consumer-install-fail", async (workspace) => {
    const fakeBin = path.join(workspace, ".fake-bin");
    const fakeHome = path.join(workspace, ".fake-home");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.mkdir(path.join(fakeHome, ".nix-profile", "share", "nix-direnv"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(fakeHome, ".nix-profile", "share", "nix-direnv", "direnvrc"),
      "",
      "utf8",
    );
    await fsp.writeFile(
      path.join(fakeBin, "direnv"),
      [
        "#!/usr/bin/env bash",
        'if [[ "${1:-}" == "--version" || "${1:-}" == "allow" ]]; then exit 0; fi',
        'if [[ "${1:-}" == "exec" ]]; then echo "fake install failed" >&2; exit 42; fi',
        "exit 0",
      ].join("\n") + "\n",
      { mode: 0o755 },
    );

    await assert.rejects(
      () =>
        execFileAsync(path.join(workspace, "viberoots", "init"), ["--run-install"], {
          cwd: workspace,
          env: {
            ...process.env,
            PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
            HOME: fakeHome,
            NO_DEV_SHELL: "1",
            VBR_INIT_USE_LOCAL_COMMAND: "1",
          },
        }),
      (error) => {
        const stderr = String((error as { stderr?: unknown }).stderr || "");
        assert.match(stderr, /fake install failed/);
        assert.match(stderr, /install command failed: direnv exec/);
        assert.doesNotMatch(stderr, /Command failed: direnv exec/);
        return true;
      },
    );
  });
});

test("viberoots/init uses the flake command before host node is available", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-init-nix-command-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const checkout = path.join(workspace, "viberoots");
    const log = path.join(workspace, ".nix-run.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.mkdir(checkout, { recursive: true });
    await fsp.copyFile(path.join(viberootsRoot, "init"), path.join(checkout, "init"));
    await fsp.chmod(path.join(checkout, "init"), 0o755);
    await fsp.symlink("/bin/bash", path.join(fakeBin, "bash"));
    await fsp.symlink("/usr/bin/dirname", path.join(fakeBin, "dirname"));
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nprintf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}\n`,
      { mode: 0o755 },
    );

    await execFileAsync(path.join(checkout, "init"), ["--setup-direnv", "never"], {
      cwd: workspace,
      env: {
        PATH: fakeBin,
      },
    });

    const text = await fsp.readFile(log, "utf8");
    assert.match(text, /nix run path:.*\/viberoots#viberoots -- init-consumer/);
    assert.match(text, /--mode submodule/);
    assert.match(text, /--workspace-root .*viberoots-init-nix-command-/);
    assert.match(text, /--source .*\/viberoots/);
    assert.match(text, /--setup-direnv never/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("viberoots init-consumer bootstraps a remote-flake consumer workspace", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-init-remote-consumer-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();

    const { stdout, stderr } = await execFileAsync(
      path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
      [
        "init-consumer",
        "--workspace-root",
        workspace,
        "--workspace-name",
        "remote-demo",
        "--viberoots-url",
        "github:viberoots/viberoots/v1.2.3",
        "--source",
        viberootsRoot,
        "--no-lock",
        "--no-direnv",
      ],
      {
        cwd: workspace,
        env: { ...process.env, NO_DEV_SHELL: "1" },
      },
    );

    assert.match(stdout, /ok\s+workspace initialized/);
    assert.equal(stderr, "");
    assert.equal(await fsp.realpath(path.join(workspace, ".viberoots/current")), viberootsRoot);
    await assert.rejects(fsp.lstat(path.join(workspace, "viberoots")));
    assert.match(
      await fsp.readFile(path.join(workspace, ".viberoots", "workspace", "flake.nix"), "utf8"),
      /github:viberoots\/viberoots\/v1\.2\.3/,
    );
    assert.match(
      await fsp.readFile(path.join(workspace, "flake.nix"), "utf8"),
      /github:viberoots\/viberoots\/v1\.2\.3/,
    );
    await assertDirenvBootstrap(workspace);
    assert.match(
      await fsp.readFile(path.join(workspace, ".buckconfig"), "utf8"),
      /config = \.\/\.viberoots\/current\/config/,
    );
    assert.doesNotMatch(
      await fsp.readFile(path.join(workspace, "README.md"), "utf8"),
      /`viberoots\/`/,
    );
    assert.match(
      await fsp.readFile(path.join(workspace, "README.md"), "utf8"),
      /`\.viberoots\/current`/,
    );
    const agentNotes = await fsp.readFile(path.join(workspace, "projects", "AGENTS.md"), "utf8");
    assert.match(agentNotes, /shared repository tooling/);
    assert.match(agentNotes, /Do not install repository tools manually/);
    assert.match(agentNotes, /\.\.\/\.viberoots\/current\/README\.md/);
    assert.doesNotMatch(agentNotes, /\.\.\/viberoots\/README\.md/);
    assert.match(
      await fsp.readFile(path.join(workspace, "projects", "config", "shared.json"), "utf8"),
      /"schemaVersion": "viberoots-project-config@1"/,
    );
    assert.match(
      await fsp.readFile(path.join(workspace, "projects", "config", "local.json"), "utf8"),
      /"schemaVersion": "viberoots-project-local-config@1"/,
    );
    const configReadme = await fsp.readFile(
      path.join(workspace, "projects", "config", "README.md"),
      "utf8",
    );
    assert.match(configReadme, /\.viberoots\/current\/docs\/local-sprinkleref\.md/);
    assert.match(configReadme, /Use `shared\.json` for checked-in, non-secret values/);
    assert.match(configReadme, /Use `local\.json` for gitignored, per-operator values/);
    assert.match(configReadme, /Use `secret:\/\/\.\.\.` refs for true secrets/);
    const gitignore = await fsp.readFile(path.join(workspace, ".gitignore"), "utf8");
    assert.match(gitignore, /\.viberoots\//);
    assert.match(gitignore, /buck-out\//);
    assert.match(gitignore, /\.direnv\//);
    assert.match(gitignore, /\.nix-zsh\//);
    assert.match(gitignore, /\.nix-gcroots\//);
    assert.match(gitignore, /^node_modules$/m);
    assert.match(gitignore, /node_modules\//);
    assert.match(gitignore, /projects\/config\/local\.json/);
    if (process.platform === "darwin") {
      await fsp.stat(path.join(workspace, ".metadata_never_index"));
    }
    assert.deepEqual(await visibleRootEntries(workspace), ["README.md", "flake.nix", "projects"]);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("viberoots init-consumer leaves unchanged generated files untouched", async () => {
  await withConsumerWorkspace(
    "viberoots-init-stable-generated",
    async (workspace, viberootsRoot) => {
      const command = path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots");
      const args = [
        "init-consumer",
        "--workspace-root",
        workspace,
        "--workspace-name",
        "stable-generated",
        "--viberoots-url",
        "path:viberoots",
        "--source",
        viberootsRoot,
        "--no-lock",
        "--no-direnv",
      ];
      const env = { ...process.env, NO_DEV_SHELL: "1" };

      await execFileAsync(command, args, { cwd: workspace, env });
      const flake = path.join(workspace, ".viberoots", "workspace", "flake.nix");
      const buckconfig = path.join(workspace, ".buckconfig");
      const before = {
        flake: (await fsp.stat(flake)).mtimeMs,
        buckconfig: (await fsp.stat(buckconfig)).mtimeMs,
      };
      await sleep(1100);

      await execFileAsync(command, args, { cwd: workspace, env });

      assert.equal((await fsp.stat(flake)).mtimeMs, before.flake);
      assert.equal((await fsp.stat(buckconfig)).mtimeMs, before.buckconfig);
    },
  );
});

test("viberoots init-consumer upgrades legacy unmarked generated targets without repair", async () => {
  await withConsumerWorkspace(
    "viberoots-init-legacy-targets-marker",
    async (workspace, viberootsRoot) => {
      const command = path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots");
      const args = [
        "init-consumer",
        "--workspace-root",
        workspace,
        "--workspace-name",
        "legacy-targets-marker",
        "--viberoots-url",
        "path:viberoots",
        "--source",
        viberootsRoot,
        "--no-lock",
        "--no-direnv",
      ];
      const env = { ...process.env, NO_DEV_SHELL: "1" };

      await execFileAsync(command, args, { cwd: workspace, env });
      const targets = path.join(workspace, ".viberoots", "workspace", "TARGETS");
      const marked = await fsp.readFile(targets, "utf8");
      assert.match(marked, /generated by viberoots\/init-consumer/);
      await fsp.writeFile(
        targets,
        marked.replace(/^# generated by viberoots\/init-consumer\n/, ""),
        "utf8",
      );

      const { stderr } = await execFileAsync(command, args, { cwd: workspace, env });

      assert.doesNotMatch(stderr, /\.viberoots\/workspace\/TARGETS/);
      assert.match(await fsp.readFile(targets, "utf8"), /generated by viberoots\/init-consumer/);
      await assert.rejects(
        () => fsp.stat(path.join(workspace, ".viberoots", "workspace", "backups")),
        /ENOENT/,
      );
    },
  );
});

test("viberoots init-consumer locks local submodule workspaces through filtered input", async () => {
  await withConsumerWorkspace("viberoots-init-filtered-lock", async (workspace, viberootsRoot) => {
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".nix.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nprintf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`,
      { mode: 0o755 },
    );

    await execFileAsync(
      path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
      [
        "init-consumer",
        "--workspace-root",
        workspace,
        "--workspace-name",
        "filtered-lock",
        "--viberoots-url",
        `path:${path.join(workspace, "viberoots")}`,
        "--source",
        path.join(workspace, "viberoots"),
        "--no-direnv",
      ],
      {
        cwd: workspace,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
          NO_DEV_SHELL: "1",
        },
      },
    );

    const text = await fsp.readFile(log, "utf8");
    assert.match(text, /nix flake lock --accept-flake-config --override-input viberoots path:/);
    assert.match(text, /\.viberoots\/workspace\/viberoots-flake-input/);
    assert.doesNotMatch(text, /--override-input viberoots path:.*\/viberoots(?:\s|$)/);
    assert.match(
      await fsp.readFile(path.join(workspace, ".viberoots", "workspace", "flake.nix"), "utf8"),
      /viberoots\.url = "path:\.\/viberoots-flake-input";/,
    );
    await fsp.stat(
      path.join(workspace, ".viberoots", "workspace", "viberoots-flake-input", "flake.nix"),
    );
    await assert.rejects(
      fsp.stat(path.join(workspace, ".viberoots", "workspace", "viberoots-flake-input", ".git")),
    );
  });
});

test("viberoots init-consumer refreshes and updates remote flake locks", async () => {
  await withConsumerWorkspace(
    "viberoots-init-remote-lock-update",
    async (workspace, viberootsRoot) => {
      const fakeBin = path.join(workspace, ".fake-bin");
      const log = path.join(workspace, ".nix.log");
      const hiddenLock = path.join(workspace, ".viberoots", "workspace", "flake.lock");
      await fsp.mkdir(fakeBin, { recursive: true });
      await fsp.writeFile(
        path.join(fakeBin, "nix"),
        `#!/usr/bin/env bash
printf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}
if [[ "$*" == flake\\ update* ]]; then
  mkdir -p ${JSON.stringify(path.dirname(hiddenLock))}
  cat > ${JSON.stringify(hiddenLock)} <<'JSON'
{"nodes":{"viberoots":{"locked":{"rev":"new-remote-rev"}}},"root":"root","version":7}
JSON
fi
exit 0
`,
        { mode: 0o755 },
      );

      await execFileAsync(
        path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
        [
          "init-consumer",
          "--workspace-root",
          workspace,
          "--workspace-name",
          "remote-lock-update",
          "--viberoots-url",
          "git+https://github.com/viberoots/viberoots.git?ref=main",
          "--no-direnv",
        ],
        {
          cwd: workspace,
          env: {
            ...process.env,
            PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
            NO_DEV_SHELL: "1",
          },
        },
      );

      const text = await fsp.readFile(log, "utf8");
      assert.match(
        text,
        /nix flake update viberoots --refresh --accept-flake-config --flake path:.*\.viberoots\/workspace/,
      );
      assert.doesNotMatch(text, /nix flake lock/);
      assert.match(
        await fsp.readFile(path.join(workspace, "flake.lock"), "utf8"),
        /new-remote-rev/,
      );
    },
  );
});

test("viberoots init-consumer post-clone preserves checked-in flake files", async () => {
  await withConsumerWorkspace("viberoots-init-post-clone-preserve-flake", async (workspace) => {
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".nix.log");
    const hiddenLock = path.join(workspace, ".viberoots", "workspace", "flake.lock");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.writeFile(path.join(workspace, "flake.nix"), "checked-in root flake\n", "utf8");
    await fsp.writeFile(path.join(workspace, "flake.lock"), "checked-in root lock\n", "utf8");
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash
printf 'VBR_POST_CLONE=%s nix %s\\n' "\${VBR_POST_CLONE:-}" "$*" >> ${JSON.stringify(log)}
if [[ "$*" == flake\\ update* ]]; then
  mkdir -p ${JSON.stringify(path.dirname(hiddenLock))}
  cat > ${JSON.stringify(hiddenLock)} <<'JSON'
{"nodes":{"viberoots":{"locked":{"rev":"new-remote-rev"}}},"root":"root","version":7}
JSON
fi
exit 0
`,
      { mode: 0o755 },
    );

    const oldPath = process.env.PATH;
    const oldNoDevShell = process.env.NO_DEV_SHELL;
    try {
      process.env.PATH = `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`;
      process.env.NO_DEV_SHELL = "1";
      await initConsumer({
        workspaceRoot: workspace,
        workspaceName: "post-clone-preserve-flake",
        viberootsUrl: "git+https://github.com/viberoots/viberoots.git?ref=main",
        allowDirenv: false,
        postClone: true,
      });
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldNoDevShell === undefined) delete process.env.NO_DEV_SHELL;
      else process.env.NO_DEV_SHELL = oldNoDevShell;
    }

    const text = await fsp.readFile(log, "utf8");
    assert.match(text, /nix flake update viberoots/);
    assert.equal(
      await fsp.readFile(path.join(workspace, "flake.nix"), "utf8"),
      "checked-in root flake\n",
    );
    assert.equal(
      await fsp.readFile(path.join(workspace, "flake.lock"), "utf8"),
      "checked-in root lock\n",
    );
    assert.match(await fsp.readFile(hiddenLock, "utf8"), /new-remote-rev/);
  });
});

test("curlable bootstrap defaults to flake main and install enabled", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-flake-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".bootstrap.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash\nprintf 'git %s\\n' "$*" >> ${JSON.stringify(log)}\nif [[ "$*" == "rev-parse --is-inside-work-tree" ]]; then exit 1; fi\nexit 0\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nprintf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}\nprintf "fetching Git repository 'https://github.com/viberoots/viberoots.git'...\\n" >&2\nprintf 'remote: Enumerating objects: 26, done.\\n' >&2\nprintf 'remote: Counting objects: 100%% (26/26), done.\\n' >&2\nprintf 'remote: Compressing objects: 100%% (2/2), done.\\n' >&2\nprintf 'remote: Total 15 (delta 13), reused 15 (delta 13), pack-reused 0 (from 0)\\n' >&2\nprintf 'From ssh://github.com/viberoots/viberoots\\n' >&2\nprintf '   6b1103eb..b38b5f38  main       -> main\\n' >&2\nprintf 'this derivation will be built:\\n' >&2\nprintf '  /nix/store/example-viberoots.drv\\n' >&2\nprintf \"building '/nix/store/example-viberoots.drv'...\\n\" >&2\nprintf 'kept nix diagnostic\\n' >&2\nexit 0\n`,
      { mode: 0o755 },
    );
    const { stdout, stderr } = await execFileAsync(path.join(viberootsRoot, "bootstrap"), [], {
      cwd: workspace,
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
    });

    const text = await fsp.readFile(log, "utf8");
    assert.match(text, /git rev-parse --is-inside-work-tree/);
    assert.match(text, /git init/);
    assert.match(
      text,
      /nix flake metadata --refresh --json --accept-flake-config --no-write-lock-file git\+https:\/\/github\.com\/viberoots\/viberoots\.git\?ref=main/,
    );
    assert.match(
      text,
      /nix run --refresh --accept-flake-config git\+https:\/\/github\.com\/viberoots\/viberoots\.git\?ref=main#viberoots/,
    );
    assert.match(text, /--mode flake/);
    assert.match(
      text,
      /--viberoots-url git\+https:\/\/github\.com\/viberoots\/viberoots\.git\?ref=main/,
    );
    assert.match(text, /--run-install/);
    assert.match(stdout, /viberoots bootstrap/);
    assert.match(stdout, /set\s+mode flake/);
    assert.match(stdout, /set\s+ensure nix yes/);
    assert.match(stdout, /set\s+install yes/);
    assert.match(stdout, /set\s+validate no/);
    assert.match(stdout, /set\s+direnv allow yes/);
    assert.match(stdout, /viberoots bootstrap summary/);
    assert.match(stdout, /ok\s+status bootstrapped/);
    assert.match(stdout, /run\s+source fetching viberoots/);
    assert.match(stdout, /set\s+actions\n\s+- initialized git repository/);
    assert.match(stdout, /ok\s+next cd .* && direnv exec \. sh -lc 'i && b && v'/);
    assert.match(stdout, /run\s+devshell direnv may load .*\/\.envrc now/);
    assert.doesNotMatch(stderr, /fetching Git repository/);
    assert.doesNotMatch(stderr, /remote: Enumerating objects/);
    assert.doesNotMatch(stderr, /main\s+->\s+main/);
    assert.doesNotMatch(stderr, /this derivation will be built/);
    assert.doesNotMatch(stderr, /building '\/nix\/store\/example-viberoots\.drv'/);
    assert.match(stderr, /kept nix diagnostic/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap reports closed beta when official repo is inaccessible", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-no-access-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".bootstrap.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash
printf 'git %s\\n' "$*" >> ${JSON.stringify(log)}
case "$*" in
  "rev-parse --is-inside-work-tree") exit 1 ;;
  "init --quiet") exit 0 ;;
  "ls-remote --exit-code https://github.com/viberoots/viberoots.git main")
    printf 'remote: Repository not found.\\n' >&2
    printf 'fatal: repository not found\\n' >&2
    exit 128
    ;;
esac
exit 0
`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nprintf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`,
      { mode: 0o755 },
    );

    await assert.rejects(
      execFileAsync(path.join(viberootsRoot, "bootstrap"), ["--workspace-root", workspace], {
        cwd: workspace,
        env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
      }),
      (error: unknown) => {
        const err = error as { stderr?: string; stdout?: string };
        assert.match(err.stdout || "", /viberoots bootstrap/);
        assert.match(err.stderr || "", /viberoots is currently in closed beta/);
        assert.match(err.stderr || "", /needs access to the private viberoots GitHub repository/);
        assert.match(err.stderr || "", /ask for\s+an invite to the viberoots closed beta/);
        assert.match(err.stderr || "", /Repository not found/);
        return true;
      },
    );

    const text = await fsp.readFile(log, "utf8");
    assert.match(
      text,
      /git ls-remote --exit-code https:\/\/github\.com\/viberoots\/viberoots\.git main/,
    );
    assert.doesNotMatch(text, /nix run/);
    assert.doesNotMatch(text, /nix flake metadata/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap accepts VBR_URL source override", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-url-override-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const { stdout } = await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      ["--workspace-root", workspace, "--no-run-install"],
      {
        cwd: workspace,
        env: {
          ...process.env,
          VBR_URL: "github:viberoots/viberoots/main",
          VIBEROOTS_DRY_RUN: "1",
        },
      },
    );

    assert.match(stdout, /set\s+viberoots url github:viberoots\/viberoots\/main/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap uses rev query for explicit revision", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-rev-url-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const { stdout } = await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      ["--workspace-root", workspace, "--no-run-install"],
      {
        cwd: workspace,
        env: {
          ...process.env,
          VBR_REV: sha,
          VIBEROOTS_DRY_RUN: "1",
        },
      },
    );

    assert.match(
      stdout,
      /set\s+viberoots url git\+https:\/\/github\.com\/viberoots\/viberoots\.git\?rev=0123456789abcdef0123456789abcdef01234567/,
    );
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap keeps full commit-looking --ref values as refs", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-ref-url-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const { stdout } = await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      ["--workspace-root", workspace, "--no-run-install", "--ref", sha],
      {
        cwd: workspace,
        env: {
          ...process.env,
          VIBEROOTS_DRY_RUN: "1",
        },
      },
    );

    assert.match(
      stdout,
      /set\s+viberoots url git\+https:\/\/github\.com\/viberoots\/viberoots\.git\?ref=0123456789abcdef0123456789abcdef01234567/,
    );
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap rejects short explicit revisions", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-short-rev-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    await assert.rejects(
      execFileAsync(path.join(viberootsRoot, "bootstrap"), [
        "--workspace-root",
        workspace,
        "--no-run-install",
        "--rev",
        "0123456",
      ]),
      /--rev must be a full 40-character commit SHA/,
    );
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap can run validation internally", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-validate-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".bootstrap.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash\nprintf 'git %s\\n' "$*" >> ${JSON.stringify(log)}\nif [[ "$*" == "rev-parse --is-inside-work-tree" ]]; then exit 1; fi\nexit 0\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nprintf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "direnv"),
      `#!/usr/bin/env bash\nprintf 'direnv %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`,
      { mode: 0o755 },
    );

    const { stdout } = await execFileAsync(path.join(viberootsRoot, "bootstrap"), [], {
      cwd: workspace,
      env: {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
        VIBEROOTS_RUN_VALIDATE: "1",
      },
    });

    const text = await fsp.readFile(log, "utf8");
    assert.match(stdout, /set\s+validate yes/);
    assert.match(stdout, /ok\s+validation complete/);
    assert.match(text, /direnv exec .* sh -lc i && b && v/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap migrates generated buckconfig with legacy prelude path", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-legacy-buckconfig-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".bootstrap.log");
    await fsp.mkdir(path.join(workspace, ".viberoots", "workspace"), { recursive: true });
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.writeFile(path.join(workspace, ".buckroot"), ".\n", "utf8");
    await fsp.writeFile(
      path.join(workspace, ".buckconfig"),
      `# generated by viberoots/init-consumer
[buildfile]
name = TARGETS

[repositories]
root = .
viberoots = ./.viberoots/current
prelude = ./.viberoots/current/prelude

[cells]
root = .
viberoots = ./.viberoots/current
prelude = ./.viberoots/current/prelude
`,
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspace, ".envrc"),
      "# generated by viberoots/init-consumer\n",
      "utf8",
    );
    await fsp.writeFile(path.join(workspace, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    await fsp.writeFile(
      path.join(workspace, ".viberoots", "workspace", "flake.nix"),
      'viberoots.url = "git+https://github.com/viberoots/viberoots.git?ref=main";\n',
      "utf8",
    );
    await fsp.symlink("../viberoots", path.join(workspace, ".viberoots", "current"));
    await fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash\nprintf 'git %s\\n' "$*" >> ${JSON.stringify(log)}\nif [[ "$*" == "rev-parse --is-inside-work-tree" ]]; then exit 0; fi\nif [[ "$*" == "rev-parse --git-path viberoots-bootstrap-write-test" ]]; then printf '.git/viberoots-bootstrap-write-test\\n'; exit 0; fi\nexit 0\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nprintf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`,
      { mode: 0o755 },
    );

    const { stdout } = await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      ["--workspace-root", workspace, "--no-run-install"],
      {
        cwd: workspace,
        env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
      },
    );

    assert.match(stdout, /ok\s+migration refreshed \.buckconfig prelude path/);
    assert.match(stdout, /migrated \.buckconfig prelude path/);
    const buckconfig = await fsp.readFile(path.join(workspace, ".buckconfig"), "utf8");
    assert.match(buckconfig, /\.viberoots\/workspace\/prelude/);
    assert.doesNotMatch(buckconfig, /\.viberoots\/current\/prelude/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap preserves generated submodule buckconfig prelude path", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-submodule-buckconfig-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".bootstrap.log");
    await fsp.mkdir(path.join(workspace, ".viberoots", "workspace"), { recursive: true });
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.mkdir(path.join(workspace, ".git"), { recursive: true });
    await fsp.mkdir(path.join(workspace, "viberoots"), { recursive: true });
    await fsp.writeFile(path.join(workspace, "viberoots", "init"), "#!/usr/bin/env bash\n", {
      mode: 0o755,
    });
    await fsp.writeFile(path.join(workspace, ".buckroot"), ".\n", "utf8");
    await fsp.writeFile(
      path.join(workspace, ".buckconfig"),
      `# generated by viberoots/init-consumer
[buildfile]
name = TARGETS

[repositories]
root = .
viberoots = ./.viberoots/current
prelude = ./.viberoots/current/prelude

[cells]
root = .
viberoots = ./.viberoots/current
prelude = ./.viberoots/current/prelude
`,
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspace, ".envrc"),
      "# generated by viberoots/init-consumer\n",
      "utf8",
    );
    await fsp.writeFile(path.join(workspace, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    await fsp.writeFile(
      path.join(workspace, ".viberoots", "workspace", "flake.nix"),
      'viberoots.url = "path:./viberoots-flake-input";\n',
      "utf8",
    );
    await fsp.symlink("../viberoots", path.join(workspace, ".viberoots", "current"));
    await fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash\nprintf 'git %s\\n' "$*" >> ${JSON.stringify(log)}\nif [[ "$*" == "rev-parse --is-inside-work-tree" ]]; then exit 0; fi\nif [[ "$*" == "rev-parse --git-path viberoots-bootstrap-write-test" ]]; then printf '.git/viberoots-bootstrap-write-test\\n'; exit 0; fi\nexit 0\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nprintf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`,
      { mode: 0o755 },
    );

    const { stdout } = await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      ["--mode", "submodule", "--workspace-root", workspace, "--no-run-install"],
      {
        cwd: workspace,
        env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
      },
    );

    assert.doesNotMatch(stdout, /migration refreshed \.buckconfig prelude path/);
    assert.doesNotMatch(stdout, /migrated \.buckconfig prelude path/);
    const buckconfig = await fsp.readFile(path.join(workspace, ".buckconfig"), "utf8");
    assert.match(buckconfig, /\.viberoots\/current\/prelude/);
    assert.doesNotMatch(buckconfig, /\.viberoots\/workspace\/prelude/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap dry-run reports planned actions without commands", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-dry-run-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".bootstrap.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nprintf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 1\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash\nprintf 'git %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 1\n`,
      { mode: 0o755 },
    );

    const { stdout } = await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      ["--workspace-root", workspace, "--no-run-install"],
      {
        cwd: workspace,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
          VIBEROOTS_DRY_RUN: "1",
        },
      },
    );

    assert.match(stdout, /set\s+dry run yes/);
    assert.match(stdout, /planned actions/);
    assert.match(stdout, /run viberoots init-consumer/);
    await assert.rejects(fsp.readFile(log, "utf8"));
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap colors headings and status markers when color is forced", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-color-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const { stdout } = await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      ["--workspace-root", workspace, "--no-run-install"],
      {
        cwd: workspace,
        env: {
          ...process.env,
          NO_COLOR: "",
          VBR_COLOR: "always",
          VIBEROOTS_DRY_RUN: "1",
        },
      },
    );

    assert.match(stdout, /\u001b\[1;38;5;141mviberoots bootstrap\u001b\[0m/);
    assert.match(stdout, /\u001b\[35;1mset\u001b\[0m/);
    assert.match(stdout, /\u001b\[1mmode\u001b\[0m/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap honors NO_COLOR over forced color", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-no-color-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const { stdout } = await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      ["--workspace-root", workspace, "--no-run-install"],
      {
        cwd: workspace,
        env: {
          ...process.env,
          NO_COLOR: "1",
          VBR_COLOR: "always",
          VIBEROOTS_DRY_RUN: "1",
        },
      },
    );

    assert.doesNotMatch(stdout, /\u001b\[/);
    assert.match(stdout, /set\s+mode flake/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap colors terminal-program sessions even when stdout is captured", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-terminal-color-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const { stdout } = await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      ["--workspace-root", workspace, "--no-run-install"],
      {
        cwd: workspace,
        env: {
          ...process.env,
          NO_COLOR: "",
          TERM_PROGRAM: "iTerm.app",
          VBR_COLOR: "",
          VIBEROOTS_DRY_RUN: "1",
        },
      },
    );

    assert.match(stdout, /\u001b\[1;38;5;141mviberoots bootstrap\u001b\[0m/);
    assert.match(stdout, /\u001b\[35;1mset\u001b\[0m/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap resumes and completes an interrupted transaction", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-resume-transaction-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".bootstrap.log");
    const transactionDir = path.join(workspace, ".viberoots", "bootstrap", "transactions");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.mkdir(transactionDir, { recursive: true });
    await fsp.writeFile(
      path.join(transactionDir, "current.json"),
      JSON.stringify(
        {
          schema: 1,
          transactionId: "resume-test",
          status: "planned",
          ownerPid: 99999999,
          mode: "flake",
          workspaceRoot: workspace,
          workspaceName: "resume-demo",
          source: "github:viberoots/viberoots/main",
          to: { ref: "main", url: "github:viberoots/viberoots/main", rev: "unknown" },
        },
        null,
        2,
      ),
      "utf8",
    );
    await fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash\nprintf 'git %s\\n' "$*" >> ${JSON.stringify(log)}\nif [[ "$*" == "rev-parse --is-inside-work-tree" ]]; then exit 1; fi\nexit 0\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nprintf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`,
      { mode: 0o755 },
    );

    const { stdout } = await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      ["--workspace-root", workspace, "--workspace-name", "resume-demo", "--no-run-install"],
      {
        cwd: workspace,
        env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
      },
    );

    assert.match(
      stdout,
      /bootstrap transaction: resuming \.viberoots\/bootstrap\/transactions\/current\.json/,
    );
    assert.match(stdout, /resumed incomplete bootstrap transaction/);
    assert.match(stdout, /completed bootstrap transaction/);
    assert.match(stdout, /ok\s+status bootstrapped/);
    await assert.rejects(fsp.lstat(path.join(transactionDir, "current.json")));
    assert.equal((await fsp.readdir(path.join(transactionDir, "completed"))).length, 1);
    assert.match(
      await fsp.readFile(log, "utf8"),
      /nix run --refresh --accept-flake-config git\+https:\/\/github\.com\/viberoots\/viberoots\.git\?ref=main#viberoots/,
    );
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap installs git through nix when git is missing", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-git-install-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const fakeHome = path.join(workspace, ".fake-home");
    const fakeProfileBin = path.join(fakeHome, ".nix-profile", "bin");
    const log = path.join(workspace, ".bootstrap.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.mkdir(fakeProfileBin, { recursive: true });
    await fsp.symlink("/bin/bash", path.join(fakeBin, "bash"));
    await fsp.symlink("/bin/cat", path.join(fakeBin, "cat"));
    await fsp.symlink("/bin/mkdir", path.join(fakeBin, "mkdir"));
    await fsp.symlink("/bin/mv", path.join(fakeBin, "mv"));
    await fsp.symlink("/bin/date", path.join(fakeBin, "date"));
    await fsp.symlink("/usr/bin/grep", path.join(fakeBin, "grep"));
    await fsp.symlink("/usr/bin/awk", path.join(fakeBin, "awk"));
    await fsp.symlink("/usr/bin/sed", path.join(fakeBin, "sed"));
    await fsp.symlink("/usr/bin/head", path.join(fakeBin, "head"));
    await fsp.symlink("/usr/bin/dirname", path.join(fakeBin, "dirname"));
    await fsp.symlink("/usr/bin/basename", path.join(fakeBin, "basename"));
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nprintf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeProfileBin, "nix"),
      `#!/usr/bin/env bash\nprintf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeProfileBin, "git"),
      `#!/usr/bin/env bash\nprintf 'git %s\\n' "$*" >> ${JSON.stringify(log)}\nif [[ "$*" == "rev-parse --is-inside-work-tree" ]]; then exit 1; fi\nexit 0\n`,
      { mode: 0o755 },
    );

    const { stdout } = await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      ["--no-run-install"],
      {
        cwd: workspace,
        env: {
          ...process.env,
          HOME: fakeHome,
          PATH: fakeBin,
          VIBEROOTS_DIRENV_ALLOW: "0",
        },
      },
    );

    const text = await fsp.readFile(log, "utf8");
    assert.match(text, /nix profile install nixpkgs#git/);
    assert.match(text, /git init/);
    assert.match(text, /--no-direnv/);
    assert.doesNotMatch(text, /--run-install/);
    assert.match(stdout, /set\s+direnv allow no/);
    assert.match(stdout, /ok\s+next cd .* && direnv allow && direnv exec \. sh -lc 'i && b && v'/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap installs nix when nix is missing", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-nix-install-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const fakeNixProfile = path.join(workspace, ".fake-nix-profile");
    const log = path.join(workspace, ".bootstrap.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.mkdir(path.join(fakeNixProfile, "etc", "profile.d"), { recursive: true });
    for (const [name, real] of [
      ["bash", "/bin/bash"],
      ["cat", "/bin/cat"],
      ["mkdir", "/bin/mkdir"],
      ["mv", "/bin/mv"],
      ["date", "/bin/date"],
      ["grep", "/usr/bin/grep"],
      ["awk", "/usr/bin/awk"],
      ["sed", "/usr/bin/sed"],
      ["head", "/usr/bin/head"],
      ["dirname", "/usr/bin/dirname"],
      ["basename", "/usr/bin/basename"],
      ["sh", "/bin/sh"],
    ]) {
      await fsp.symlink(real, path.join(fakeBin, name));
    }
    await fsp.writeFile(
      path.join(fakeBin, "curl"),
      `#!/usr/bin/env bash\nprintf 'curl %s\\n' "$*" >> ${JSON.stringify(log)}\nprintf '#!/usr/bin/env sh\\nexit 0\\n'\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeNixProfile, "etc", "profile.d", "nix-daemon.sh"),
      `export PATH=${JSON.stringify(fakeNixProfile)}/bin:$PATH\n`,
      "utf8",
    );
    await fsp.mkdir(path.join(fakeNixProfile, "bin"), { recursive: true });
    await fsp.writeFile(
      path.join(fakeNixProfile, "bin", "nix"),
      `#!/usr/bin/env bash\nprintf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeNixProfile, "bin", "git"),
      `#!/usr/bin/env bash\nprintf 'git %s\\n' "$*" >> ${JSON.stringify(log)}\nif [[ "$*" == "rev-parse --is-inside-work-tree" ]]; then exit 1; fi\nexit 0\n`,
      { mode: 0o755 },
    );

    await execFileAsync(path.join(viberootsRoot, "bootstrap"), ["--no-run-install"], {
      cwd: workspace,
      env: {
        ...process.env,
        HOME: workspace,
        PATH: fakeBin,
        VBR_ALLOW_NIX_INSTALL: "1",
        VIBEROOTS_NIX_PROFILE_SCRIPT: path.join(
          fakeNixProfile,
          "etc",
          "profile.d",
          "nix-daemon.sh",
        ),
      },
    });

    const text = await fsp.readFile(log, "utf8");
    assert.match(
      text,
      /curl --proto =https --tlsv1.2 -sSf -L https:\/\/install\.determinate\.systems\/nix/,
    );
    assert.match(
      text,
      /nix run --refresh --accept-flake-config git\+https:\/\/github\.com\/viberoots\/viberoots\.git\?ref=main#viberoots/,
    );
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap can refuse automatic nix installation", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-no-nix-install-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    await fsp.mkdir(fakeBin, { recursive: true });
    for (const [name, real] of [
      ["bash", "/bin/bash"],
      ["cat", "/bin/cat"],
      ["dirname", "/usr/bin/dirname"],
      ["basename", "/usr/bin/basename"],
    ]) {
      await fsp.symlink(real, path.join(fakeBin, name));
    }

    await assert.rejects(
      execFileAsync(path.join(viberootsRoot, "bootstrap"), ["--no-install-nix"], {
        cwd: workspace,
        env: {
          ...process.env,
          PATH: fakeBin,
        },
      }),
      /nix is required/,
    );
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap accepts configured macOS developer tools", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-xcode-ready-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".bootstrap.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    for (const [name, real] of [
      ["bash", "/bin/bash"],
      ["cat", "/bin/cat"],
      ["mkdir", "/bin/mkdir"],
      ["mv", "/bin/mv"],
      ["date", "/bin/date"],
      ["grep", "/usr/bin/grep"],
      ["awk", "/usr/bin/awk"],
      ["sed", "/usr/bin/sed"],
      ["head", "/usr/bin/head"],
      ["dirname", "/usr/bin/dirname"],
      ["basename", "/usr/bin/basename"],
      ["sh", "/bin/sh"],
    ]) {
      await fsp.symlink(real, path.join(fakeBin, name));
    }
    await fsp.writeFile(path.join(fakeBin, "uname"), "#!/usr/bin/env bash\nprintf 'Darwin\\n'\n", {
      mode: 0o755,
    });
    await fsp.writeFile(
      path.join(fakeBin, "xcode-select"),
      `#!/usr/bin/env bash\nprintf 'xcode-select %s\\n' "$*" >> ${JSON.stringify(log)}\nif [[ "\${1:-}" == "-p" ]]; then printf '/Applications/Xcode.app/Contents/Developer\\n'; exit 0; fi\nif [[ "\${1:-}" == "--install" ]]; then exit 42; fi\nexit 0\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "xcrun"),
      `#!/usr/bin/env bash\nprintf 'xcrun %s\\n' "$*" >> ${JSON.stringify(log)}\ncase "$*" in\n  "--find clang") printf '/usr/bin/clang\\n'; exit 0 ;;\n  "--sdk macosx --show-sdk-path") printf '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk\\n'; exit 0 ;;\nesac\nexit 1\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nprintf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash\nprintf 'git %s\\n' "$*" >> ${JSON.stringify(log)}\nif [[ "$*" == "rev-parse --is-inside-work-tree" ]]; then exit 1; fi\nexit 0\n`,
      { mode: 0o755 },
    );

    const { stdout } = await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      ["--no-run-install"],
      {
        cwd: workspace,
        env: { ...process.env, PATH: fakeBin },
      },
    );

    const text = await fsp.readFile(log, "utf8");
    assert.match(stdout, /ok\s+xcode developer tools ready/);
    assert.match(text, /xcode-select -p/);
    assert.match(text, /xcrun --find clang/);
    assert.doesNotMatch(text, /xcode-select --install/);
    assert.match(text, /nix run --refresh --accept-flake-config/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap starts macOS developer tools installer when missing", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-xcode-install-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".bootstrap.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    for (const [name, real] of [
      ["bash", "/bin/bash"],
      ["cat", "/bin/cat"],
      ["dirname", "/usr/bin/dirname"],
      ["basename", "/usr/bin/basename"],
    ]) {
      await fsp.symlink(real, path.join(fakeBin, name));
    }
    await fsp.writeFile(path.join(fakeBin, "uname"), "#!/usr/bin/env bash\nprintf 'Darwin\\n'\n", {
      mode: 0o755,
    });
    await fsp.writeFile(
      path.join(fakeBin, "xcode-select"),
      `#!/usr/bin/env bash\nprintf 'xcode-select %s\\n' "$*" >> ${JSON.stringify(log)}\nif [[ "\${1:-}" == "-p" ]]; then exit 1; fi\nif [[ "\${1:-}" == "--install" ]]; then exit 0; fi\nexit 1\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "xcrun"),
      `#!/usr/bin/env bash\nprintf 'xcrun %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 1\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nprintf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`,
      { mode: 0o755 },
    );

    await assert.rejects(
      execFileAsync(path.join(viberootsRoot, "bootstrap"), ["--no-run-install"], {
        cwd: workspace,
        env: { ...process.env, PATH: fakeBin },
      }),
      /Started the Xcode Command Line Tools installer/,
    );

    const text = await fsp.readFile(log, "utf8");
    assert.match(text, /xcode-select -p/);
    assert.match(text, /xcode-select --install/);
    assert.doesNotMatch(text, /nix /);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap can drive the submodule mode through the same entrypoint", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-submodule-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".bootstrap.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.mkdir(path.join(workspace, ".git"), { recursive: true });
    await fsp.mkdir(path.join(workspace, "viberoots"), { recursive: true });
    await fsp.writeFile(
      path.join(workspace, "viberoots", "init"),
      `#!/usr/bin/env bash\nprintf 'init %s\\n' "$*" >> ${JSON.stringify(log)}\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash\nprintf 'git %s\\n' "$*" >> ${JSON.stringify(log)}\ncase "$*" in\n  "rev-parse --is-inside-work-tree") exit 0 ;;\n  "rev-parse --git-path viberoots-bootstrap-write-test") printf '.git/viberoots-bootstrap-write-test\\n'; exit 0 ;;\n  "-C viberoots rev-parse --verify --quiet "*) exit 1 ;;\nesac\nexit 0\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\necho "unexpected nix call" >&2\nexit 1\n`,
      { mode: 0o755 },
    );

    await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      [
        "--mode",
        "submodule",
        "--ref",
        "feature/test",
        "--workspace-root",
        workspace,
        "--workspace-name",
        "demo",
      ],
      {
        cwd: workspace,
        env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
      },
    );

    const text = await fsp.readFile(log, "utf8");
    assert.match(text, /git -C viberoots fetch origin feature\/test/);
    assert.doesNotMatch(text, /submodule add/);
    assert.match(text, /init --mode submodule --workspace-name demo --run-install/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap skips setup when already bootstrapped", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-idempotent-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".bootstrap.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.mkdir(path.join(workspace, ".git"), { recursive: true });
    await fsp.mkdir(path.join(workspace, "viberoots"), { recursive: true });
    await fsp.writeFile(
      path.join(workspace, "viberoots", "init"),
      `#!/usr/bin/env bash
printf 'init %s\\n' "$*" >> ${JSON.stringify(log)}
mkdir -p projects .viberoots/workspace
: > .buckroot
: > .buckconfig
: > flake.nix
printf '%s\\n' 'use flake "path:\${PWD}/.viberoots/workspace#default" --override-input viberoots "path:\${PWD}/viberoots"' > .envrc
ln -s ../viberoots .viberoots/current
: > .viberoots/workspace/flake.nix
`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash\nprintf 'git %s\\n' "$*" >> ${JSON.stringify(log)}\ncase "$*" in\n  "rev-parse --is-inside-work-tree") exit 0 ;;\n  "rev-parse --git-path viberoots-bootstrap-write-test") printf '.git/viberoots-bootstrap-write-test\\n'; exit 0 ;;\n  "-C viberoots rev-parse --verify --quiet "*) exit 1 ;;\nesac\nexit 0\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\necho "unexpected nix call" >&2\nexit 1\n`,
      { mode: 0o755 },
    );

    await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      ["--mode", "submodule", "--workspace-root", workspace, "--workspace-name", "demo"],
      {
        cwd: workspace,
        env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
      },
    );
    const second = await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      ["--mode", "submodule", "--workspace-root", workspace, "--workspace-name", "demo"],
      {
        cwd: workspace,
        env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
      },
    );

    const text = await fsp.readFile(log, "utf8");
    assert.equal((text.match(/^init /gm) ?? []).length, 1);
    assert.match(second.stdout, /ok\s+status already up to date/);
    assert.match(second.stdout, /no setup changes needed/);
    assert.match(second.stdout, /set\s+source https:\/\/github\.com\/viberoots\/viberoots\.git/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("viberoots bootstrap-check repairs a stale submodule transaction", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-check-repair-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    await fsp.symlink(viberootsRoot, path.join(workspace, "viberoots"));
    await fsp.mkdir(path.join(workspace, ".viberoots", "bootstrap", "transactions"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(workspace, ".viberoots", "bootstrap", "transactions", "current.json"),
      JSON.stringify(
        {
          schema: 1,
          transactionId: "stale-test",
          status: "planned",
          ownerPid: 99999999,
          mode: "submodule",
          workspaceRoot: workspace,
          workspaceName: "repair-demo",
          source: "https://github.com/viberoots/viberoots.git",
          from: { ref: "unknown", rev: "unknown" },
          to: { ref: "main", url: "https://github.com/viberoots/viberoots.git", rev: "unknown" },
        },
        null,
        2,
      ),
      "utf8",
    );

    const { stderr } = await execFileAsync(
      path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
      ["bootstrap-check", "--workspace-root", workspace, "--repair-if-needed"],
      {
        cwd: workspace,
        env: { ...process.env, NO_DEV_SHELL: "1" },
      },
    );

    assert.match(stderr, /repairing incomplete bootstrap transaction stale-test/);
    assert.match(stderr, /no known migration steps necessary/);
    assert.equal(await fsp.readlink(path.join(workspace, ".viberoots", "current")), "../viberoots");
    await assert.rejects(
      fsp.lstat(path.join(workspace, ".viberoots", "bootstrap", "transactions", "current.json")),
    );
    assert.equal(
      (
        await fsp.lstat(
          path.join(
            workspace,
            ".viberoots",
            "bootstrap",
            "transactions",
            "completed",
            "stale-test.json",
          ),
        )
      ).isFile(),
      true,
    );
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("viberoots bootstrap-check skips active transactions", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-check-active-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    await fsp.mkdir(path.join(workspace, ".viberoots", "bootstrap", "transactions"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(workspace, ".viberoots", "bootstrap", "transactions", "current.json"),
      JSON.stringify(
        {
          schema: 1,
          transactionId: "active-test",
          status: "planned",
          ownerPid: process.pid,
          mode: "submodule",
          workspaceRoot: workspace,
          workspaceName: "active-demo",
          to: { ref: "main", url: "https://github.com/viberoots/viberoots.git" },
        },
        null,
        2,
      ),
      "utf8",
    );

    const { stdout, stderr } = await execFileAsync(
      path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
      [
        "bootstrap-check",
        "--workspace-root",
        workspace,
        "--repair-if-needed",
        "--verbose",
        "--json",
      ],
      {
        cwd: workspace,
        env: { ...process.env, NO_DEV_SHELL: "1" },
      },
    );

    assert.match(stderr, /bootstrap transaction still active/);
    assert.deepEqual(JSON.parse(stdout), {
      checked: true,
      repaired: false,
      skippedReason: "active-transaction",
    });
    assert.equal(
      (
        await fsp.lstat(
          path.join(workspace, ".viberoots", "bootstrap", "transactions", "current.json"),
        )
      ).isFile(),
      true,
    );
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap refuses an untrusted custom submodule URL non-interactively", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-untrusted-submodule-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".bootstrap.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.mkdir(path.join(workspace, ".git"), { recursive: true });
    await fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash\nprintf 'git %s\\n' "$*" >> ${JSON.stringify(log)}\nif [[ "$*" == "rev-parse --is-inside-work-tree" ]]; then exit 0; fi\nexit 0\n`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nprintf 'nix %s\\n' "$*" >> ${JSON.stringify(log)}\nexit 0\n`,
      { mode: 0o755 },
    );

    await assert.rejects(
      execFileAsync(
        path.join(viberootsRoot, "bootstrap"),
        [
          "--mode",
          "submodule",
          "--workspace-root",
          workspace,
          "--submodule-url",
          "https://example.invalid/viberoots.git",
        ],
        {
          cwd: workspace,
          env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
        },
      ),
      /refusing non-default submodule URL without confirmation/,
    );

    const text = await fsp.readFile(log, "utf8");
    assert.doesNotMatch(text, /submodule add/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap can explicitly trust a custom submodule URL", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-trusted-submodule-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".bootstrap.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.mkdir(path.join(workspace, ".git"), { recursive: true });
    await fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash
printf 'git %s\\n' "$*" >> ${JSON.stringify(log)}
case "$*" in
  "rev-parse --is-inside-work-tree") exit 0 ;;
  "rev-parse --git-path viberoots-bootstrap-write-test") printf '.git/viberoots-bootstrap-write-test\\n'; exit 0 ;;
  "submodule add https://example.invalid/viberoots.git viberoots")
    mkdir -p viberoots
    cat > viberoots/init <<'EOS'
#!/usr/bin/env bash
printf 'init %s\\n' "$*" >> ${JSON.stringify(log)}
EOS
    chmod +x viberoots/init
    exit 0
    ;;
  "-C viberoots rev-parse --verify --quiet "*) exit 1 ;;
esac
exit 0
`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\necho "unexpected nix call" >&2\nexit 1\n`,
      { mode: 0o755 },
    );

    const { stdout } = await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      [
        "--mode",
        "submodule",
        "--workspace-root",
        workspace,
        "--workspace-name",
        "trusted-demo",
        "--submodule-url",
        "https://example.invalid/viberoots.git",
      ],
      {
        cwd: workspace,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
          VIBEROOTS_TRUST_SUBMODULE_URL: "1",
        },
      },
    );

    const text = await fsp.readFile(log, "utf8");
    assert.match(stdout, /set\s+trust custom submodule url yes/);
    assert.match(text, /git submodule add https:\/\/example\.invalid\/viberoots\.git viberoots/);
    assert.match(text, /init --mode submodule --workspace-name trusted-demo --run-install/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap initializes an existing viberoots submodule", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-existing-submodule-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const fakeBin = path.join(workspace, ".fake-bin");
    const log = path.join(workspace, ".bootstrap.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.mkdir(path.join(workspace, ".git"), { recursive: true });
    await fsp.writeFile(
      path.join(workspace, ".gitmodules"),
      `[submodule "viberoots"]\n\tpath = viberoots\n\turl = https://github.com/viberoots/viberoots.git\n`,
      "utf8",
    );
    await fsp.writeFile(
      path.join(fakeBin, "git"),
      `#!/usr/bin/env bash
printf 'git %s\\n' "$*" >> ${JSON.stringify(log)}
case "$*" in
  "rev-parse --is-inside-work-tree") exit 0 ;;
  "rev-parse --git-path viberoots-bootstrap-write-test") printf '.git/viberoots-bootstrap-write-test\\n'; exit 0 ;;
  "config -f .gitmodules --get-regexp ^submodule\\..*\\.path$") printf 'submodule.viberoots.path viberoots\\n'; exit 0 ;;
  "config -f .gitmodules --get submodule.viberoots.url") printf 'https://github.com/viberoots/viberoots.git\\n'; exit 0 ;;
  "submodule update --init --recursive viberoots")
    mkdir -p viberoots
    cat > viberoots/init <<'EOS'
#!/usr/bin/env bash
printf 'init %s\\n' "$*" >> ${JSON.stringify(log)}
EOS
    chmod +x viberoots/init
    exit 0
    ;;
  "-C viberoots rev-parse --verify --quiet "*) exit 1 ;;
esac
exit 0
`,
      { mode: 0o755 },
    );
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\necho "unexpected nix call" >&2\nexit 1\n`,
      { mode: 0o755 },
    );

    await execFileAsync(
      path.join(viberootsRoot, "bootstrap"),
      ["--mode", "submodule", "--workspace-root", workspace, "--workspace-name", "existing-demo"],
      {
        cwd: workspace,
        env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` },
      },
    );

    const text = await fsp.readFile(log, "utf8");
    assert.match(text, /git submodule update --init --recursive viberoots/);
    assert.doesNotMatch(text, /submodule add/);
    assert.match(text, /init --mode submodule --workspace-name existing-demo --run-install/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap accepts mode and install defaults from environment", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-env-mode-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();

    const { stdout } = await execFileAsync(path.join(viberootsRoot, "bootstrap"), ["--dry-run"], {
      cwd: workspace,
      env: {
        ...process.env,
        VIBEROOTS_CONSUMER_MODE: "submodule",
        VIBEROOTS_RUN_INSTALL: "0",
      },
    });

    assert.match(stdout, /set\s+mode submodule/);
    assert.match(stdout, /set\s+ensure nix yes/);
    assert.match(stdout, /set\s+install no/);
    assert.match(stdout, /add or update viberoots submodule/);
    assert.doesNotMatch(stdout, /run i/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap accepts VBR-prefixed option aliases", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-vbr-env-mode-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const targetWorkspace = path.join(workspace, "target-workspace");

    const { stdout } = await execFileAsync(path.join(viberootsRoot, "bootstrap"), ["--dry-run"], {
      cwd: workspace,
      env: {
        ...process.env,
        VBR_CONSUMER: "submodule",
        VBR_WORKSPACE_ROOT: targetWorkspace,
        VBR_RUN_INSTALL: "0",
        VBR_DIRENV_ALLOW: "0",
      },
    });

    assert.match(stdout, /set\s+mode submodule/);
    assert.match(stdout, /set\s+ensure nix yes/);
    assert.match(
      stdout,
      new RegExp(`workspace ${targetWorkspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    assert.match(stdout, /set\s+install no/);
    assert.match(stdout, /set\s+direnv allow no/);
    assert.match(stdout, /add or update viberoots submodule/);
    assert.doesNotMatch(stdout, /run i/);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

test("curlable bootstrap ignores ambient WORKSPACE_ROOT without explicit VBR_WORKSPACE_ROOT", async () => {
  const workspace = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), "viberoots-bootstrap-ambient-workspace-root-")),
  );
  try {
    const viberootsRoot = await findViberootsRoot();
    const ambientWorkspace = path.join(workspace, "old-workspace");
    await fsp.mkdir(ambientWorkspace, { recursive: true });

    const { stdout } = await execFileAsync(path.join(viberootsRoot, "bootstrap"), ["--dry-run"], {
      cwd: workspace,
      env: {
        ...process.env,
        WORKSPACE_ROOT: ambientWorkspace,
        VBR_RUN_INSTALL: "0",
      },
    });

    assert.match(
      stdout,
      new RegExp(`workspace ${workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    assert.doesNotMatch(
      stdout,
      new RegExp(ambientWorkspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
});

async function visibleRootEntries(workspace: string): Promise<string[]> {
  return (await fsp.readdir(workspace)).filter((entry) => !entry.startsWith(".")).sort();
}

test("viberoots/init preserves existing edited docs", async () => {
  await withConsumerWorkspace("viberoots-init-preserve", async (workspace) => {
    await fsp.mkdir(path.join(workspace, "projects"), { recursive: true });
    await fsp.mkdir(path.join(workspace, "projects", "config"), { recursive: true });
    await fsp.writeFile(path.join(workspace, "README.md"), "custom root\n", "utf8");
    await fsp.writeFile(path.join(workspace, "projects", "README.md"), "custom projects\n", "utf8");
    await fsp.writeFile(path.join(workspace, "projects", "AGENTS.md"), "custom agents\n", "utf8");
    await fsp.writeFile(
      path.join(workspace, "projects", "config", "README.md"),
      "custom config docs\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspace, "projects", "config", "shared.json"),
      `${JSON.stringify({ schemaVersion: "custom-shared" }, null, 2)}\n`,
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspace, "projects", "config", "local.json"),
      `${JSON.stringify(
        {
          schemaVersion: "custom-local",
          values: { "control-plane": { aws: { "account-id": "kept" } } },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await execFileAsync(path.join(workspace, "viberoots", "init"), [], {
      cwd: workspace,
      env: {
        ...process.env,
        PATH: process.env.PATH ?? "",
        NO_DEV_SHELL: "1",
        VBR_INIT_USE_LOCAL_COMMAND: "1",
      },
    });

    assert.equal(await fsp.readFile(path.join(workspace, "README.md"), "utf8"), "custom root\n");
    assert.equal(
      await fsp.readFile(path.join(workspace, "projects", "README.md"), "utf8"),
      "custom projects\n",
    );
    assert.equal(
      await fsp.readFile(path.join(workspace, "projects", "AGENTS.md"), "utf8"),
      "custom agents\n",
    );
    assert.equal(
      await fsp.readFile(path.join(workspace, "projects", "config", "README.md"), "utf8"),
      "custom config docs\n",
    );
    assert.match(
      await fsp.readFile(path.join(workspace, "projects", "config", "shared.json"), "utf8"),
      /"schemaVersion": "custom-shared"/,
    );
    const localConfig = JSON.parse(
      await fsp.readFile(path.join(workspace, "projects", "config", "local.json"), "utf8"),
    );
    assert.equal(localConfig.schemaVersion, "viberoots-project-local-config@1");
    assert.equal(localConfig.values["control-plane"].aws["account-id"], "kept");
    assert.equal(localConfig.values["control-plane"].aws["organization-id"], "");
  });
});

test("viberoots/init repairs stale generated workspace files", async () => {
  await withConsumerWorkspace("viberoots-init-repair", async (workspace) => {
    await fsp.mkdir(path.join(workspace, ".viberoots", "workspace"), { recursive: true });
    await fsp.mkdir(path.join(workspace, ".viberoots", "bootstrap"), { recursive: true });
    await fsp.mkdir(path.join(workspace, "wrong-viberoots"), { recursive: true });
    await fsp.symlink("../wrong-viberoots", path.join(workspace, ".viberoots", "current"));
    await fsp.writeFile(path.join(workspace, ".envrc"), "stale envrc\n", "utf8");
    await fsp.writeFile(
      path.join(workspace, ".viberoots", "bootstrap", "direnv-stage0.sh"),
      "stale direnv stage0\n",
      "utf8",
    );
    await fsp.writeFile(path.join(workspace, ".buckroot"), "custom buckroot\n", "utf8");
    await fsp.writeFile(
      path.join(workspace, ".viberoots", "workspace", "flake.nix"),
      "stale flake\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(workspace, ".viberoots", "workspace", "TARGETS"),
      "stale targets\n",
      "utf8",
    );

    const { stderr } = await execFileAsync(path.join(workspace, "viberoots", "init"), [], {
      cwd: workspace,
      env: {
        ...process.env,
        PATH: process.env.PATH ?? "",
        NO_DEV_SHELL: "1",
        VBR_INIT_USE_LOCAL_COMMAND: "1",
      },
    });

    assert.match(stderr, /repair: \.viberoots\/current now points to \.\.\/viberoots/);
    assert.match(stderr, /repair: \.envrc/);
    assert.match(stderr, /repair: \.viberoots\/bootstrap\/direnv-stage0\.sh/);
    assert.match(stderr, /repair: \.buckroot/);
    assert.match(stderr, /repair: \.viberoots\/workspace\/flake\.nix/);
    assert.match(stderr, /repair: \.viberoots\/workspace\/TARGETS/);
    assert.equal(await fsp.readFile(path.join(workspace, ".buckroot"), "utf8"), ".\n");
    await assertDirenvBootstrap(workspace);
    assert.match(
      await fsp.readFile(path.join(workspace, ".viberoots", "workspace", "flake.nix"), "utf8"),
      /path:\.\/viberoots-flake-input/,
    );
    assert.match(
      await fsp.readFile(path.join(workspace, ".viberoots", "workspace", "TARGETS"), "utf8"),
      /name = "flake\.lock"/,
    );
    assert.equal(await fsp.readlink(path.join(workspace, ".viberoots", "current")), "../viberoots");
    const backups = await fsp.readdir(path.join(workspace, ".viberoots", "workspace", "backups"));
    assert.equal(backups.length, 5);
  });
});

test("viberoots/init handles missing direnv before devshell activation", async () => {
  await withConsumerWorkspace("viberoots-init-no-direnv", async (workspace) => {
    const fakeBin = path.join(workspace, "fake-bin");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.symlink("/bin/bash", path.join(fakeBin, "bash"));
    await fsp.symlink(process.execPath, path.join(fakeBin, "node"));
    const pathWithoutDirenv = [fakeBin, "/bin", "/usr/bin"].join(path.delimiter);

    const { stdout, stderr } = await execFileAsync(
      path.join(workspace, "viberoots", "init"),
      ["--setup-direnv", "never"],
      {
        cwd: workspace,
        env: {
          ...process.env,
          PATH: pathWithoutDirenv,
          NO_DEV_SHELL: "",
          VBR_INIT_USE_LOCAL_COMMAND: "1",
        },
      },
    );

    assert.match(stdout, /ok\s+workspace initialized/);
    assert.match(stderr, /direnv is not installed or not on PATH/);
    assert.equal(await fsp.readlink(path.join(workspace, ".viberoots", "current")), "../viberoots");
    assert.equal(
      (await fsp.stat(path.join(workspace, ".viberoots", "workspace"))).isDirectory(),
      true,
    );
  });
});
