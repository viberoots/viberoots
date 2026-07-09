#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { runLiveBootstrap } from "../../lib/live-bootstrap";
import { planViberootsGc, runViberootsGc } from "../../lib/maintenance-gc";
import { WORKSPACE_RESOURCE_GRAPH_DIR } from "../../lib/workspace-state-paths";

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

async function writeExecutable(file: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content, { mode: 0o755 });
}

async function makeOld(file: string): Promise<void> {
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const stat = await fsp.lstat(file);
  if (stat.isSymbolicLink()) {
    await fsp.lutimes(file, old, old);
  } else {
    await fsp.utimes(file, old, old);
  }
}

test("viberoots bootstrap and update invoke trusted bootstrap URL with VBR overrides", async () => {
  await withTempWorkspace("viberoots-live-bootstrap", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    const bin = path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots");
    const capture = path.join(workspace, "env.txt");
    const script = path.join(workspace, "bootstrap.sh");
    await writeExecutable(
      script,
      `#!/usr/bin/env bash
{
  printf 'VBR_CONSUMER=%s\\n' "\${VBR_CONSUMER:-}"
  printf 'VBR_REF=%s\\n' "\${VBR_REF:-}"
  printf 'VBR_REV=%s\\n' "\${VBR_REV:-}"
  printf 'VBR_WORKSPACE_ROOT=%s\\n' "\${VBR_WORKSPACE_ROOT:-}"
  printf 'VBR_RUN_INSTALL=%s\\n' "\${VBR_RUN_INSTALL:-}"
  printf 'VBR_RUN_VALIDATE=%s\\n' "\${VBR_RUN_VALIDATE:-}"
  printf 'VBR_DIRENV_ALLOW=%s\\n' "\${VBR_DIRENV_ALLOW:-}"
  printf 'VBR_DRY_RUN=%s\\n' "\${VBR_DRY_RUN:-}"
} > "\${VBR_CAPTURE_ENV}"
`,
    );

    for (const command of ["bootstrap", "update"]) {
      await fsp.rm(capture, { force: true });
      await execFileAsync(
        bin,
        [
          command,
          "--bootstrap-url",
          `file://${script}`,
          "--trust-bootstrap-url",
          "--mode",
          "submodule",
          "--ref",
          "release-test",
          "--rev",
          "0123456789abcdef0123456789abcdef01234567",
          "--workspace-root",
          workspace,
          "--no-run-install",
          "--run-validate",
          "--no-direnv-allow",
          "--dry-run",
        ],
        {
          cwd: workspace,
          env: {
            ...process.env,
            NO_DEV_SHELL: "1",
            VBR_CAPTURE_ENV: capture,
            VBR_REF: "ignored-by-cli-flag",
          },
        },
      );
      const envText = await fsp.readFile(capture, "utf8");
      assert.match(envText, /VBR_CONSUMER=submodule/);
      assert.match(envText, /VBR_REF=release-test/);
      assert.match(envText, /VBR_REV=0123456789abcdef0123456789abcdef01234567/);
      assert.match(
        envText,
        new RegExp(`VBR_WORKSPACE_ROOT=${workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      );
      assert.match(envText, /VBR_RUN_INSTALL=0/);
      assert.match(envText, /VBR_RUN_VALIDATE=1/);
      assert.match(envText, /VBR_DIRENV_ALLOW=0/);
      assert.match(envText, /VBR_DRY_RUN=1/);
    }
  });
});

test("viberoots post-clone invokes shared bootstrap with locked-mode preset", async () => {
  await withTempWorkspace("viberoots-live-post-clone", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    const bin = path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots");
    const capture = path.join(workspace, "env.txt");
    const script = path.join(workspace, "bootstrap.sh");
    await writeExecutable(
      script,
      `#!/usr/bin/env bash
{
  printf 'VBR_POST_CLONE=%s\\n' "\${VBR_POST_CLONE:-}"
  printf 'VBR_WORKSPACE_ROOT=%s\\n' "\${VBR_WORKSPACE_ROOT:-}"
  printf 'VBR_RUN_INSTALL=%s\\n' "\${VBR_RUN_INSTALL:-}"
  printf 'VBR_DIRENV_ALLOW=%s\\n' "\${VBR_DIRENV_ALLOW:-}"
  printf 'VBR_DRY_RUN=%s\\n' "\${VBR_DRY_RUN:-}"
} > "\${VBR_CAPTURE_ENV}"
`,
    );

    await execFileAsync(
      bin,
      [
        "post-clone",
        "--bootstrap-url",
        `file://${script}`,
        "--trust-bootstrap-url",
        "--workspace-root",
        workspace,
        "--no-install",
        "--no-direnv-allow",
        "--dry-run",
      ],
      {
        cwd: workspace,
        env: {
          ...process.env,
          NO_DEV_SHELL: "1",
          VBR_CAPTURE_ENV: capture,
        },
      },
    );

    const envText = await fsp.readFile(capture, "utf8");
    assert.match(envText, /VBR_POST_CLONE=1/);
    assert.match(
      envText,
      new RegExp(`VBR_WORKSPACE_ROOT=${workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    assert.match(envText, /VBR_RUN_INSTALL=0/);
    assert.match(envText, /VBR_DIRENV_ALLOW=0/);
    assert.match(envText, /VBR_DRY_RUN=1/);
  });
});

test("viberoots update defaults to the enclosing workspace root from subdirectories", async () => {
  await withTempWorkspace("viberoots-live-bootstrap-subdir", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    const bin = path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots");
    const subdir = path.join(workspace, "projects", "apps");
    const capture = path.join(workspace, "env.txt");
    const script = path.join(workspace, "bootstrap.sh");
    await fsp.mkdir(path.join(workspace, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(
      path.join(workspace, ".viberoots", "workspace", "flake.nix"),
      "{ outputs = _: {}; }\n",
      "utf8",
    );
    await fsp.mkdir(subdir, { recursive: true });
    await writeExecutable(
      script,
      `#!/usr/bin/env bash
printf 'VBR_WORKSPACE_ROOT=%s\\n' "\${VBR_WORKSPACE_ROOT:-}" > "\${VBR_CAPTURE_ENV}"
`,
    );

    await execFileAsync(
      bin,
      ["update", "--bootstrap-url", `file://${script}`, "--trust-bootstrap-url", "--dry-run"],
      {
        cwd: subdir,
        env: {
          ...process.env,
          NO_DEV_SHELL: "1",
          VBR_CAPTURE_ENV: capture,
          WORKSPACE_ROOT: "",
          _VIBEROOTS_DEVSHELL_ROOT: "",
          BUCK_TEST_SRC: "",
          LIVE_ROOT: "",
        },
      },
    );

    const envText = await fsp.readFile(capture, "utf8");
    assert.match(
      envText,
      new RegExp(`VBR_WORKSPACE_ROOT=${workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
  });
});

test("standalone bootstrap discovers the enclosing workspace root from subdirectories", async () => {
  await withTempWorkspace("viberoots-standalone-bootstrap-subdir", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    const subdir = path.join(workspace, "projects", "apps");
    await fsp.mkdir(path.join(workspace, ".viberoots", "workspace"), { recursive: true });
    await fsp.writeFile(
      path.join(workspace, ".viberoots", "workspace", "flake.nix"),
      "{ outputs = _: {}; }\n",
      "utf8",
    );
    await fsp.mkdir(subdir, { recursive: true });

    const run = await execFileAsync("bash", [path.join(viberootsRoot, "bootstrap")], {
      cwd: subdir,
      env: {
        ...process.env,
        VBR_DRY_RUN: "1",
        VBR_RUN_INSTALL: "0",
        VBR_DIRENV_ALLOW: "0",
        WORKSPACE_ROOT: "",
        _VIBEROOTS_DEVSHELL_ROOT: "",
        BUCK_TEST_SRC: "",
        LIVE_ROOT: "",
      },
    });

    assert.match(
      run.stdout,
      new RegExp(`workspace\\s+${workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    await assert.rejects(fsp.access(path.join(subdir, ".viberoots", "workspace", "flake.nix")));
    await assert.rejects(fsp.access(path.join(subdir, ".envrc")));
  });
});

test("standalone post-clone reads checked-in locked rev from nested directories", async () => {
  await withTempWorkspace("viberoots-standalone-post-clone", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    const subdir = path.join(workspace, "projects", "apps");
    const lockedRev = "0123456789abcdef0123456789abcdef01234567";
    await fsp.mkdir(subdir, { recursive: true });
    await fsp.writeFile(
      path.join(workspace, "flake.lock"),
      JSON.stringify({ nodes: { viberoots: { locked: { rev: lockedRev } } } }, null, 2),
      "utf8",
    );

    const run = await execFileAsync("bash", [path.join(viberootsRoot, "bootstrap")], {
      cwd: subdir,
      env: {
        ...process.env,
        VBR_POST_CLONE: "1",
        VBR_DRY_RUN: "1",
        VBR_RUN_INSTALL: "0",
        VBR_DIRENV_ALLOW: "0",
        WORKSPACE_ROOT: "",
        _VIBEROOTS_DEVSHELL_ROOT: "",
        BUCK_TEST_SRC: "",
        LIVE_ROOT: "",
      },
    });

    assert.match(run.stdout, /post-clone\s+yes/);
    assert.match(run.stdout, new RegExp(`rev\\s+${lockedRev}`));
    assert.match(run.stdout, /use locked viberoots revision/);
    assert.match(run.stdout, /i && b && v/);
  });
});

test("standalone post-clone fails clearly for missing and invalid lock state", async () => {
  const viberootsRoot = await findViberootsRoot();
  await withTempWorkspace("viberoots-post-clone-missing-lock", async (workspace) => {
    await assert.rejects(
      execFileAsync("bash", [path.join(viberootsRoot, "bootstrap")], {
        cwd: workspace,
        env: { ...process.env, VBR_POST_CLONE: "1", VBR_DRY_RUN: "1" },
      }),
      /post-clone requires an existing checked-in flake\.lock/,
    );
  });
  await withTempWorkspace("viberoots-post-clone-missing-node", async (workspace) => {
    await fsp.writeFile(
      path.join(workspace, "flake.lock"),
      JSON.stringify({ nodes: {} }, null, 2),
      "utf8",
    );
    await assert.rejects(
      execFileAsync("bash", [path.join(viberootsRoot, "bootstrap")], {
        cwd: workspace,
        env: { ...process.env, VBR_POST_CLONE: "1", VBR_DRY_RUN: "1" },
      }),
      /could not find nodes\.viberoots\.locked\.rev/,
    );
  });
  await withTempWorkspace("viberoots-post-clone-invalid-rev", async (workspace) => {
    await fsp.writeFile(
      path.join(workspace, "flake.lock"),
      JSON.stringify({ nodes: { viberoots: { locked: { rev: "abc123" } } } }, null, 2),
      "utf8",
    );
    await assert.rejects(
      execFileAsync("bash", [path.join(viberootsRoot, "bootstrap")], {
        cwd: workspace,
        env: { ...process.env, VBR_POST_CLONE: "1", VBR_DRY_RUN: "1" },
      }),
      /full 40-character commit SHA/,
    );
  });
});

test("live bootstrap refuses untrusted custom URL and invalid downloaded content", async () => {
  await assert.rejects(
    runLiveBootstrap({
      command: "bootstrap",
      bootstrapUrl: "https://example.invalid/bootstrap",
      deps: { fetchText: async () => "#!/usr/bin/env bash\n" },
    }),
    /custom bootstrap URL/,
  );
  await assert.rejects(
    runLiveBootstrap({
      command: "bootstrap",
      bootstrapUrl: "https://example.invalid/bootstrap",
      trustBootstrapUrl: true,
      deps: { fetchText: async () => "not shell", runCommand: async () => {} },
    }),
    /did not look like a shell bootstrap script/,
  );
});

test("gc plan uses normal nix gc by default and optimization only when requested", async () => {
  await withTempWorkspace("viberoots-gc-plan", async (workspace) => {
    const base = {
      workspaceRoot: workspace,
      deps: { commandAvailable: async (command: string) => command === "nix" },
    };
    const normal = await planViberootsGc(base);
    assert.deepEqual(
      normal.nix.map((command) => [command.command, command.args]),
      [["nix", ["store", "gc"]]],
    );

    const localOnly = await planViberootsGc({ ...base, nix: false });
    assert.deepEqual(localOnly.nix, []);

    const optimized = await planViberootsGc({ ...base, optimize: true });
    assert.deepEqual(
      optimized.nix.map((command) => [command.command, command.args]),
      [
        ["nix", ["store", "gc"]],
        ["nix", ["store", "optimise"]],
      ],
    );

    const aged = await planViberootsGc({ ...base, nixDeleteOlderThan: "7d" });
    assert.deepEqual(
      aged.nix.map((command) => [command.command, command.args]),
      [
        ["nix", ["profile", "wipe-history", "--older-than", "7d"]],
        ["nix", ["store", "gc"]],
      ],
    );

    const agedWithCollector = await planViberootsGc({
      ...base,
      nixDeleteOlderThan: "7d",
      deps: { commandAvailable: async (command: string) => command === "nix-collect-garbage" },
    });
    assert.deepEqual(
      agedWithCollector.nix.map((command) => [command.command, command.args]),
      [["nix-collect-garbage", ["--delete-older-than", "7d"]]],
    );
  });
});

test("gc dry-run plans local generated cleanup without mutation or nix execution", async () => {
  await withTempWorkspace("viberoots-gc-dry", async (workspace) => {
    const stale = path.join(workspace, ".viberoots", "workspace", "buck", "tmp", "old");
    const symlink = path.join(workspace, ".viberoots", "workspace", "buck", "tmp", "escape");
    await fsp.mkdir(stale, { recursive: true });
    await fsp.writeFile(path.join(stale, "artifact"), "abc", "utf8");
    await fsp.symlink(os.tmpdir(), symlink);
    await makeOld(stale);
    let ran = false;
    const summary = await runViberootsGc({
      workspaceRoot: workspace,
      dryRun: true,
      localOlderThanMs: -1,
      deps: {
        commandAvailable: async (command) => command === "nix",
        runCommand: async () => {
          ran = true;
        },
      },
    });
    assert.equal(ran, false);
    assert.equal(summary.localRemoved, 0);
    assert.equal((await fsp.stat(stale)).isDirectory(), true);
    assert.match(
      summary.plan.local.map((entry) => entry.path).join("\n"),
      /\.viberoots\/workspace\/buck\/tmp\/old/,
    );
    assert.match(
      summary.plan.skipped.map((entry) => entry.reason).join("\n"),
      /symlink cleanup candidate refused/,
    );
  });
});

test("gc treats resource graph workspace output as regenerable state", async () => {
  await withTempWorkspace("viberoots-gc-resource-graph", async (workspace) => {
    const graphDir = path.join(workspace, WORKSPACE_RESOURCE_GRAPH_DIR);
    const durableGraphDir = path.join(workspace, ".local", "control-plane", "resource-graph");
    await fsp.mkdir(graphDir, { recursive: true });
    await fsp.writeFile(path.join(graphDir, "nodes.json"), "{}", "utf8");
    await fsp.mkdir(durableGraphDir, { recursive: true });
    await fsp.writeFile(path.join(durableGraphDir, "nodes.json"), "{}", "utf8");

    const dryRun = await runViberootsGc({
      workspaceRoot: workspace,
      dryRun: true,
      nix: false,
      deps: { commandAvailable: async () => false },
    });
    assert.match(
      dryRun.plan.local.map((entry) => `${entry.path}:${entry.reason}`).join("\n"),
      /\.viberoots\/workspace\/resource-graph:regenerable resource graph workspace state/,
    );
    assert.equal((await fsp.stat(graphDir)).isDirectory(), true);
    assert.equal((await fsp.stat(durableGraphDir)).isDirectory(), true);

    const summary = await runViberootsGc({
      workspaceRoot: workspace,
      nix: false,
      deps: { commandAvailable: async () => false },
    });
    assert.equal(summary.localRemoved, 1);
    await assert.rejects(fsp.lstat(graphDir));
    assert.equal((await fsp.stat(durableGraphDir)).isDirectory(), true);
  });
});

test("gc wrapper runs full gc by default and can disable nix from nested consumer directories", async () => {
  await withTempWorkspace("viberoots-gc-wrapper", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    const binDir = path.join(viberootsRoot, "build-tools", "tools", "bin");
    const nested = path.join(workspace, "projects", "apps", "demo");
    await fsp.mkdir(nested, { recursive: true });
    const { stdout } = await execFileAsync("gc", ["--dry-run", "--workspace-root", workspace], {
      cwd: nested,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        NO_DEV_SHELL: "1",
        VIBEROOTS_ROOT: viberootsRoot,
      },
    });
    assert.match(stdout, /viberoots gc plan/);
    assert.match(stdout, /nix store gc/);

    const localOnly = await execFileAsync(
      "gc",
      ["--dry-run", "--no-nix", "--workspace-root", workspace],
      {
        cwd: nested,
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
          NO_DEV_SHELL: "1",
          VIBEROOTS_ROOT: viberootsRoot,
        },
      },
    );
    assert.match(localOnly.stdout, /nix cleanup disabled or unavailable/);
  });
});

test("gc plan summarizes skipped paths unless verbose is requested", async () => {
  await withTempWorkspace("viberoots-gc-skipped", async (workspace) => {
    const viberootsRoot = await findViberootsRoot();
    const bin = path.join(viberootsRoot, "build-tools", "tools", "bin", "viberoots");
    const tmp = path.join(workspace, ".viberoots", "buck", "tmp");
    await fsp.mkdir(tmp, { recursive: true });
    const skipped = path.join(tmp, "buck-go-123");
    await fsp.symlink(os.tmpdir(), skipped);
    await makeOld(skipped);

    const env = {
      ...process.env,
      NO_DEV_SHELL: "1",
      VIBEROOTS_ROOT: viberootsRoot,
    };
    const compact = await execFileAsync(
      bin,
      ["gc", "--dry-run", "--no-nix", "--workspace-root", workspace],
      {
        cwd: workspace,
        env,
      },
    );
    assert.match(compact.stdout, /1 skipped \(symlink cleanup candidate refused\)/);
    assert.doesNotMatch(compact.stdout, /buck-go-123 \(symlink cleanup candidate refused\)/);

    const verbose = await execFileAsync(
      bin,
      ["gc", "--dry-run", "--no-nix", "--verbose", "--workspace-root", workspace],
      {
        cwd: workspace,
        env,
      },
    );
    assert.match(verbose.stdout, /buck-go-123 \(symlink cleanup candidate refused\)/);
  });
});

test("gc execution removes planned generated state and prunes old completed transactions", async () => {
  await withTempWorkspace("viberoots-gc-run", async (workspace) => {
    const stale = path.join(workspace, ".viberoots", "buck", "tmp", "old");
    const completed = path.join(workspace, ".viberoots", "bootstrap", "transactions", "completed");
    await fsp.mkdir(stale, { recursive: true });
    await fsp.writeFile(path.join(stale, "artifact"), "abc", "utf8");
    await fsp.mkdir(completed, { recursive: true });
    const oldTx = path.join(completed, "old.json");
    const newTx = path.join(completed, "new.json");
    await fsp.writeFile(oldTx, "{}", "utf8");
    await fsp.writeFile(newTx, "{}", "utf8");
    await makeOld(stale);
    await makeOld(oldTx);
    const commands: string[] = [];
    const summary = await runViberootsGc({
      workspaceRoot: workspace,
      localOlderThanMs: 1,
      keepCompletedTransactions: 1,
      deps: {
        commandAvailable: async (command) => command === "nix",
        runCommand: async (command, args) => void commands.push([command, ...args].join(" ")),
      },
    });
    assert.equal(summary.localRemoved, 2);
    await assert.rejects(fsp.lstat(stale));
    await assert.rejects(fsp.lstat(oldTx));
    assert.equal(await fsp.readFile(newTx, "utf8"), "{}");
    assert.deepEqual(commands, ["nix store gc"]);
  });
});

test("gc skips incomplete transaction and refuses aggressive mode while active work is present", async () => {
  await withTempWorkspace("viberoots-gc-active", async (workspace) => {
    const current = path.join(workspace, ".viberoots", "bootstrap", "transactions", "current.json");
    await fsp.mkdir(path.dirname(current), { recursive: true });
    await fsp.writeFile(current, JSON.stringify({ ownerPid: process.pid }), "utf8");
    const plan = await planViberootsGc({
      workspaceRoot: workspace,
      deps: { commandAvailable: async () => false },
    });
    assert.match(plan.skipped.map((entry) => entry.path).join("\n"), /current\.json/);
    await assert.rejects(
      planViberootsGc({
        workspaceRoot: workspace,
        aggressive: true,
        deps: { commandAvailable: async () => false },
      }),
      /refusing aggressive gc/,
    );
  });
});
