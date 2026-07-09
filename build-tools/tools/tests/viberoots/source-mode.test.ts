#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

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

async function withTempWorkspace(
  prefix: string,
  fn: (workspace: string) => Promise<void>,
): Promise<void> {
  const workspace = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`)));
  try {
    await fn(workspace);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
}

async function writeMinimalSourceTree(root: string): Promise<void> {
  await fsp.mkdir(path.join(root, "build-tools", "tools", "dev"), { recursive: true });
  await fsp.mkdir(path.join(root, "prelude"), { recursive: true });
  await fsp.mkdir(path.join(root, "toolchains"), { recursive: true });
  await fsp.mkdir(path.join(root, "config", "fbsource_stub"), { recursive: true });
  await fsp.mkdir(path.join(root, "config", "fbcode_stub"), { recursive: true });
  await fsp.writeFile(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs"), "", "utf8");
  await fsp.writeFile(path.join(root, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
}

async function assertDirenvBootstrap(workspace: string): Promise<void> {
  const envrc = await fsp.readFile(path.join(workspace, ".envrc"), "utf8");
  assert.match(envrc, /\.viberoots\/bootstrap\/direnv-stage0\.sh/);
  assert.doesNotMatch(envrc, /__vbr_flake_args/);

  const stage0 = await fsp.readFile(
    path.join(workspace, ".viberoots", "bootstrap", "direnv-stage0.sh"),
    "utf8",
  );
  assert.match(stage0, /__vbr_flake_input_is_generated_filtered=0/);
  assert.match(stage0, /__vbr_flake_input_is_generated_filtered=1/);
  assert.match(stage0, /if \[\[ "\$\{__vbr_flake_input_is_generated_filtered\}" == "1" \]\]/);
  assert.match(stage0, /__vbr_flake_args=\(\)/);
  assert.match(
    stage0,
    /__vbr_flake_args=\(--override-input viberoots "path:\$\{__vbr_flake_input_root\}"\)/,
  );
  assert.match(stage0, /__vbr_stage0_filtered_viberoots_input\(\)/);
  assert.match(stage0, /viberoots-flake-input/);
  assert.match(stage0, /export VIBEROOTS_SOURCE_ROOT="\$\{__vbr_source_root\}"/);
  assert.match(stage0, /__vbr_current_real.*__vbr_filtered_real/s);
  assert.match(stage0, /readlink "\$\{PWD\}\/\.viberoots\/current"/);
  assert.match(stage0, /!= "\.\.\/viberoots"/);
  assert.match(stage0, /rm -f "\$\{PWD\}\/\.viberoots\/current" && ln -s \.\.\/viberoots/);
  assert.match(stage0, /--exclude \/\.viberoots/);
  assert.match(stage0, /--exclude \/node_modules/);
  assert.match(stage0, /"\$\{__vbr_current_real\}" == "\$\{__vbr_local_real\}"/);
  assert.match(stage0, /__vbr_stage0_apply_nix_cache_health \|\| return 1/);
}

async function writeFakeGit(
  workspace: string,
  opts: {
    submodule?: boolean;
    gitlink?: boolean;
    dirtySubmodule?: boolean;
    metadataStatus?: string;
    submoduleUrl?: string;
  } = {},
): Promise<{ fakeBin: string; log: string }> {
  const fakeBin = path.join(workspace, ".fake-bin");
  const log = path.join(workspace, ".git.log");
  await fsp.mkdir(fakeBin, { recursive: true });
  await fsp.writeFile(
    path.join(fakeBin, "git"),
    `#!/usr/bin/env bash
printf 'git %s\\n' "$*" >> ${JSON.stringify(log)}
case "$*" in
  "rev-parse --is-inside-work-tree") echo true; exit 0 ;;
  "config -f .gitmodules --get-regexp ^submodule\\\\..*\\\\.path$")
    ${opts.submodule ? "printf 'submodule.viberoots.path viberoots\\n'" : ":"}
    exit 0
    ;;
  "config -f .gitmodules --get submodule.viberoots.url")
    printf '%s\\n' ${JSON.stringify(opts.submoduleUrl || "https://github.com/viberoots/viberoots.git")}
    exit 0
    ;;
  "ls-files -s viberoots")
    ${opts.gitlink ? "printf '160000 0123456789012345678901234567890123456789 0\\tviberoots\\n'" : ":"}
    exit 0
    ;;
  "status --porcelain=v1")
    if [[ "$PWD" == */viberoots && ${opts.dirtySubmodule ? "1" : "0"} == "1" ]]; then
      printf ' M README.md\\n'
    fi
    exit 0
    ;;
  "status --porcelain=v1 -- .gitmodules viberoots")
    printf '%s' ${JSON.stringify(opts.metadataStatus || "")}
    exit 0
    ;;
  "submodule add https://github.com/viberoots/viberoots.git viberoots"|"submodule update --init --recursive viberoots")
    mkdir -p viberoots/build-tools/tools/dev viberoots/prelude viberoots/toolchains viberoots/config/fbsource_stub viberoots/config/fbcode_stub
    : > viberoots/build-tools/tools/dev/zx-init.mjs
    printf '{ outputs = _: {}; }\\n' > viberoots/flake.nix
    exit 0
    ;;
  "submodule deinit -f viberoots"|"rm -f viberoots")
    exit 0
    ;;
  "status --short")
    printf 'D  viberoots\\nM  .gitmodules\\n'
    exit 0
    ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  return { fakeBin, log };
}

test("viberoots help and bash completion are generated from command metadata", async () => {
  const viberootsRoot = await findViberootsRoot();
  const bin = path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots");
  const env = { ...process.env, NO_DEV_SHELL: "1" };

  const help = await execFileAsync(bin, ["help"], { cwd: viberootsRoot, env });
  for (const command of [
    "status",
    "develop",
    "init-workspace",
    "bootstrap-check",
    "bootstrap",
    "update",
    "post-clone",
    "gc",
    "resource-graph",
    "init-consumer",
    "use-submodule",
    "use-flake",
    "remove-submodule",
    "completion bash|zsh",
    "help",
  ]) {
    assert.match(help.stdout, new RegExp(`viberoots ${command}`));
  }

  const completion = await execFileAsync(bin, ["completion", "bash"], { cwd: viberootsRoot, env });
  assert.match(completion.stdout, /_viberoots\(\)/);
  assert.match(
    completion.stdout,
    /status develop init-workspace bootstrap-check bootstrap update post-clone gc resource-graph init-consumer use-submodule use-flake remove-submodule completion help/,
  );
  assert.match(completion.stdout, /complete -F _viberoots viberoots/);
  assert.match(completion.stdout, /complete -F _viberoots vbr/);
  assert.match(
    completion.stdout,
    /use-submodule\) opts="--url --trust-url --no-direnv --run-install --workspace-root --help"/,
  );
  assert.match(
    completion.stdout,
    /use-flake\) opts="--ref --remove-submodule --no-direnv --run-install --workspace-root --help"/,
  );
  assert.match(completion.stdout, /remove-submodule\) opts="--dry-run --workspace-root --help"/);

  const zshCompletion = await execFileAsync(bin, ["completion", "zsh"], {
    cwd: viberootsRoot,
    env,
  });
  assert.match(zshCompletion.stdout, /#compdef viberoots vbr/);
  assert.match(zshCompletion.stdout, /compdef _viberoots viberoots/);
  assert.match(zshCompletion.stdout, /compdef _viberoots vbr/);
  assert.match(zshCompletion.stdout, /commands=\(status develop init-workspace bootstrap-check/);
  assert.match(zshCompletion.stdout, /develop\) _arguments -S .*--command\[--command\]/);

  await assert.rejects(
    execFileAsync(bin, ["unknown-command"], { cwd: viberootsRoot, env }),
    /viberoots help/,
  );
});

test("use-submodule adds a missing submodule and repairs current symlink", async () => {
  await withTempWorkspace("viberoots-source-submodule", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    const { fakeBin, log } = await writeFakeGit(workspace);
    await execFileAsync(
      path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
      ["use-submodule", "--workspace-root", workspace, "--no-direnv"],
      {
        cwd: workspace,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
          NO_DEV_SHELL: "1",
        },
      },
    );

    assert.match(
      await fsp.readFile(log, "utf8"),
      /git submodule add https:\/\/github\.com\/viberoots\/viberoots\.git viberoots/,
    );
    assert.equal(await fsp.readlink(path.join(workspace, ".viberoots", "current")), "../viberoots");
    await assertDirenvBootstrap(workspace);
  });
});

test("use-submodule refuses an untrusted custom URL", async () => {
  await withTempWorkspace("viberoots-source-untrusted", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    const { fakeBin } = await writeFakeGit(workspace);
    await assert.rejects(
      execFileAsync(
        path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
        [
          "use-submodule",
          "--workspace-root",
          workspace,
          "--url",
          "https://example.invalid/viberoots.git",
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
      ),
      /refusing non-default submodule URL/,
    );
  });
});

test("use-submodule refuses an existing untrusted custom submodule URL", async () => {
  await withTempWorkspace("viberoots-source-existing-untrusted", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    await fsp.mkdir(path.join(workspace, "viberoots"), { recursive: true });
    const { fakeBin } = await writeFakeGit(workspace, {
      submodule: true,
      gitlink: true,
      submoduleUrl: "https://example.invalid/viberoots.git",
    });
    await assert.rejects(
      execFileAsync(
        path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
        ["use-submodule", "--workspace-root", workspace, "--no-direnv"],
        {
          cwd: workspace,
          env: {
            ...process.env,
            PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
            NO_DEV_SHELL: "1",
          },
        },
      ),
      /existing non-default submodule URL/,
    );
  });
});

test("use-flake switches generated files and leaves inactive submodule by default", async () => {
  await withTempWorkspace("viberoots-source-flake", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    const remoteSource = path.join(workspace, "remote-source");
    await writeMinimalSourceTree(remoteSource);
    await writeMinimalSourceTree(path.join(workspace, "viberoots"));
    const { fakeBin } = await writeFakeGit(workspace, { submodule: true, gitlink: true });
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nif [[ "$*" == eval* ]]; then printf '%s\\n' ${JSON.stringify(remoteSource)}; fi\n`,
      { mode: 0o755 },
    );

    await execFileAsync(
      path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
      ["use-flake", "--workspace-root", workspace, "--ref", "v1.2.3", "--no-direnv"],
      {
        cwd: workspace,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
          NO_DEV_SHELL: "1",
        },
      },
    );

    assert.equal(await fsp.realpath(path.join(workspace, ".viberoots", "current")), remoteSource);
    await assertDirenvBootstrap(workspace);
    assert.match(
      await fsp.readFile(path.join(workspace, ".viberoots", "workspace", "flake.nix"), "utf8"),
      /github:viberoots\/viberoots\/v1\.2\.3/,
    );
    assert.equal((await fsp.lstat(path.join(workspace, "viberoots"))).isDirectory(), true);
  });
});

test("use-flake preserves ssh transport from official submodule remote", async () => {
  await withTempWorkspace("viberoots-source-flake-ssh", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    const remoteSource = path.join(workspace, "remote-source");
    await writeMinimalSourceTree(remoteSource);
    await writeMinimalSourceTree(path.join(workspace, "viberoots"));
    const { fakeBin } = await writeFakeGit(workspace, {
      submodule: true,
      gitlink: true,
      submoduleUrl: "git@github.com:viberoots/viberoots.git",
    });
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nif [[ "$*" == eval* ]]; then printf '%s\\n' ${JSON.stringify(remoteSource)}; fi\n`,
      { mode: 0o755 },
    );

    await execFileAsync(
      path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
      ["use-flake", "--workspace-root", workspace, "--ref", "main", "--no-direnv"],
      {
        cwd: workspace,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
          NO_DEV_SHELL: "1",
        },
      },
    );

    const flake = await fsp.readFile(
      path.join(workspace, ".viberoots", "workspace", "flake.nix"),
      "utf8",
    );
    assert.match(flake, /git\+ssh:\/\/git@github\.com\/viberoots\/viberoots\.git\?ref=main/);
    assert.doesNotMatch(flake, /github:viberoots\/viberoots\/main/);
  });
});

test("use-flake defaults to enclosing workspace root when run from a subdirectory", async () => {
  await withTempWorkspace("viberoots-source-flake-subdir", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    const remoteSource = path.join(workspace, "remote-source");
    const subdir = path.join(workspace, "projects");
    await writeMinimalSourceTree(remoteSource);
    await writeMinimalSourceTree(path.join(workspace, "viberoots"));
    await fsp.mkdir(path.join(workspace, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(
      path.join(workspace, ".viberoots", "workspace", "flake.nix"),
      "{ outputs = _: {}; }\n",
      "utf8",
    );
    await fsp.mkdir(subdir, { recursive: true });
    const { fakeBin } = await writeFakeGit(workspace, { submodule: true, gitlink: true });
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nif [[ "$*" == eval* ]]; then printf '%s\\n' ${JSON.stringify(remoteSource)}; fi\n`,
      { mode: 0o755 },
    );

    await execFileAsync(
      path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
      ["use-flake", "--ref", "v1.2.3", "--no-direnv"],
      {
        cwd: subdir,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
          NO_DEV_SHELL: "1",
          WORKSPACE_ROOT: "",
          _VIBEROOTS_DEVSHELL_ROOT: "",
          LIVE_ROOT: "",
        },
      },
    );

    assert.equal(await fsp.realpath(path.join(workspace, ".viberoots", "current")), remoteSource);
    assert.match(
      await fsp.readFile(path.join(workspace, ".viberoots", "workspace", "flake.nix"), "utf8"),
      /github:viberoots\/viberoots\/v1\.2\.3/,
    );
    await assert.rejects(fsp.access(path.join(subdir, ".viberoots", "workspace", "flake.nix")));
    await assert.rejects(fsp.access(path.join(subdir, ".envrc")));
  });
});

test("use-flake --remove-submodule switches first, then cleans up the inactive submodule", async () => {
  await withTempWorkspace("viberoots-source-flake-remove", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    const remoteSource = path.join(workspace, "remote-source");
    await writeMinimalSourceTree(remoteSource);
    await writeMinimalSourceTree(path.join(workspace, "viberoots"));
    await fsp.mkdir(path.join(workspace, ".git", "modules", "viberoots"), { recursive: true });
    const { fakeBin, log } = await writeFakeGit(workspace, { submodule: true, gitlink: true });
    await fsp.writeFile(
      path.join(fakeBin, "nix"),
      `#!/usr/bin/env bash\nif [[ "$*" == eval* ]]; then printf '%s\\n' ${JSON.stringify(remoteSource)}; fi\n`,
      { mode: 0o755 },
    );

    await execFileAsync(
      path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
      [
        "use-flake",
        "--workspace-root",
        workspace,
        "--ref",
        "release-test",
        "--remove-submodule",
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

    assert.equal(await fsp.realpath(path.join(workspace, ".viberoots", "current")), remoteSource);
    const text = await fsp.readFile(log, "utf8");
    assert.match(text, /git submodule deinit -f viberoots/);
    assert.match(text, /git rm -f viberoots/);
  });
});

test("remove-submodule dry-run prints a plan without running destructive git commands", async () => {
  await withTempWorkspace("viberoots-source-remove-dry", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    const { fakeBin, log } = await writeFakeGit(workspace, { submodule: true, gitlink: true });
    await fsp.mkdir(path.join(workspace, ".viberoots"), { recursive: true });
    await fsp.symlink("../remote-source", path.join(workspace, ".viberoots", "current"));
    await fsp.mkdir(path.join(workspace, "viberoots"), { recursive: true });

    const result = await execFileAsync(
      path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
      ["remove-submodule", "--workspace-root", workspace, "--dry-run"],
      {
        cwd: workspace,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
          NO_DEV_SHELL: "1",
        },
      },
    );

    assert.match(result.stdout, /git submodule deinit -f viberoots/);
    assert.match(result.stdout, /git rm -f viberoots/);
    assert.doesNotMatch(await fsp.readFile(log, "utf8"), /submodule deinit|git rm -f viberoots/);
  });
});

test("remove-submodule refuses active, dirty, and plain-checkout states", async () => {
  await withTempWorkspace("viberoots-source-remove-refuse", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    await fsp.mkdir(path.join(workspace, ".viberoots"), { recursive: true });
    await fsp.mkdir(path.join(workspace, "viberoots"), { recursive: true });
    await fsp.symlink("../viberoots", path.join(workspace, ".viberoots", "current"));
    const activeGit = await writeFakeGit(workspace, { submodule: true, gitlink: true });
    await assert.rejects(
      execFileAsync(
        path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
        ["remove-submodule", "--workspace-root", workspace],
        {
          cwd: workspace,
          env: {
            ...process.env,
            PATH: `${activeGit.fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
            NO_DEV_SHELL: "1",
          },
        },
      ),
      /active viberoots submodule/,
    );

    await fsp.unlink(path.join(workspace, ".viberoots", "current"));
    await fsp.symlink("../remote-source", path.join(workspace, ".viberoots", "current"));
    const dirtyGit = await writeFakeGit(workspace, {
      submodule: true,
      gitlink: true,
      dirtySubmodule: true,
    });
    await assert.rejects(
      execFileAsync(
        path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
        ["remove-submodule", "--workspace-root", workspace],
        {
          cwd: workspace,
          env: {
            ...process.env,
            PATH: `${dirtyGit.fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
            NO_DEV_SHELL: "1",
          },
        },
      ),
      /dirty viberoots submodule/,
    );
    const plainGit = await writeFakeGit(workspace);
    await assert.rejects(
      execFileAsync(
        path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
        ["remove-submodule", "--workspace-root", workspace],
        {
          cwd: workspace,
          env: {
            ...process.env,
            PATH: `${plainGit.fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
            NO_DEV_SHELL: "1",
          },
        },
      ),
      /not a submodule/,
    );
  });
});

test("remove-submodule runs cleanup when guardrails pass", async () => {
  await withTempWorkspace("viberoots-source-remove", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    const { fakeBin, log } = await writeFakeGit(workspace, { submodule: true, gitlink: true });
    await fsp.mkdir(path.join(workspace, ".viberoots"), { recursive: true });
    await fsp.mkdir(path.join(workspace, "viberoots"), { recursive: true });
    await fsp.mkdir(path.join(workspace, ".git", "modules", "viberoots"), { recursive: true });
    await fsp.symlink("../remote-source", path.join(workspace, ".viberoots", "current"));

    await execFileAsync(
      path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots"),
      ["remove-submodule", "--workspace-root", workspace],
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
    assert.match(text, /git submodule deinit -f viberoots/);
    assert.match(text, /git rm -f viberoots/);
    await assert.rejects(fsp.lstat(path.join(workspace, ".git", "modules", "viberoots")));
  });
});
