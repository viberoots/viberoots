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

test("viberoots/init bootstraps a bare consumer workspace", async () => {
  await withConsumerWorkspace("viberoots-init-consumer", async (workspace) => {
    const fakeBin = path.join(workspace, ".fake-bin");
    const direnvLog = path.join(workspace, ".direnv.log");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.writeFile(
      path.join(fakeBin, "direnv"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(direnvLog)}\n`,
      { mode: 0o755 },
    );

    const { stdout, stderr } = await execFileAsync(path.join(workspace, "viberoots", "init"), [], {
      cwd: workspace,
      env: {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
        NO_DEV_SHELL: "1",
      },
    });

    assert.match(stdout, /viberoots workspace initialized:/);
    assert.equal(stderr, "");
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
    assert.match(
      await fsp.readFile(path.join(workspace, ".buckconfig"), "utf8"),
      /\.viberoots\/current\/prelude/,
    );
    assert.match(
      await fsp.readFile(path.join(workspace, ".envrc"), "utf8"),
      /use flake "path:\$\{PWD\}\/\.viberoots\/workspace#default" --override-input viberoots "path:\$\{VIBEROOTS_SOURCE_ROOT:-\$\{PWD\}\/viberoots\}"/,
    );
    await assert.rejects(fsp.lstat(path.join(workspace, "flake.nix")));
    await assert.rejects(fsp.lstat(path.join(workspace, "buck-out")));
    assert.match(
      await fsp.readFile(path.join(workspace, ".viberoots", "workspace", "flake.nix"), "utf8"),
      /path:.*\/viberoots/,
    );
    assert.match(
      await fsp.readFile(path.join(workspace, ".viberoots", "workspace", "flake.nix"), "utf8"),
      /builtins\.getEnv "WORKSPACE_ROOT"/,
    );
    assert.match(
      await fsp.readFile(path.join(workspace, "README.md"), "utf8"),
      /viberoots\/README\.md/,
    );
    assert.match(
      await fsp.readFile(path.join(workspace, "projects", "README.md"), "utf8"),
      /Project and application source/,
    );
    assert.equal(await fsp.readFile(direnvLog, "utf8"), `allow ${workspace}\n`);
    assert.deepEqual(await visibleRootEntries(workspace), ["README.md", "projects", "viberoots"]);
  });
});

async function visibleRootEntries(workspace: string): Promise<string[]> {
  return (await fsp.readdir(workspace)).filter((entry) => !entry.startsWith(".")).sort();
}

test("viberoots/init preserves existing edited docs", async () => {
  await withConsumerWorkspace("viberoots-init-preserve", async (workspace) => {
    await fsp.mkdir(path.join(workspace, "projects"), { recursive: true });
    await fsp.writeFile(path.join(workspace, "README.md"), "custom root\n", "utf8");
    await fsp.writeFile(path.join(workspace, "projects", "README.md"), "custom projects\n", "utf8");

    await execFileAsync(path.join(workspace, "viberoots", "init"), [], {
      cwd: workspace,
      env: {
        ...process.env,
        PATH: process.env.PATH ?? "",
        NO_DEV_SHELL: "1",
      },
    });

    assert.equal(await fsp.readFile(path.join(workspace, "README.md"), "utf8"), "custom root\n");
    assert.equal(
      await fsp.readFile(path.join(workspace, "projects", "README.md"), "utf8"),
      "custom projects\n",
    );
  });
});

test("viberoots/init repairs stale generated workspace files", async () => {
  await withConsumerWorkspace("viberoots-init-repair", async (workspace) => {
    await fsp.mkdir(path.join(workspace, ".viberoots", "workspace"), { recursive: true });
    await fsp.mkdir(path.join(workspace, "wrong-viberoots"), { recursive: true });
    await fsp.symlink("../wrong-viberoots", path.join(workspace, ".viberoots", "current"));
    await fsp.writeFile(path.join(workspace, ".envrc"), "stale envrc\n", "utf8");
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
      },
    });

    assert.match(stderr, /repair: \.viberoots\/current now points to \.\.\/viberoots/);
    assert.match(stderr, /repair: \.envrc/);
    assert.match(stderr, /repair: \.buckroot/);
    assert.match(stderr, /repair: \.viberoots\/workspace\/flake\.nix/);
    assert.match(stderr, /repair: \.viberoots\/workspace\/TARGETS/);
    assert.equal(await fsp.readFile(path.join(workspace, ".buckroot"), "utf8"), ".\n");
    assert.match(
      await fsp.readFile(path.join(workspace, ".envrc"), "utf8"),
      /generated by viberoots\/init/,
    );
    assert.match(
      await fsp.readFile(path.join(workspace, ".envrc"), "utf8"),
      /use flake "path:\$\{PWD\}\/\.viberoots\/workspace#default"/,
    );
    assert.match(
      await fsp.readFile(path.join(workspace, ".viberoots", "workspace", "flake.nix"), "utf8"),
      /path:.*\/viberoots/,
    );
    assert.match(
      await fsp.readFile(path.join(workspace, ".viberoots", "workspace", "TARGETS"), "utf8"),
      /name = "flake\.lock"/,
    );
    assert.equal(await fsp.readlink(path.join(workspace, ".viberoots", "current")), "../viberoots");
    const backups = await fsp.readdir(path.join(workspace, ".viberoots", "workspace", "backups"));
    assert.equal(backups.length, 4);
  });
});

test("viberoots/init handles missing direnv before devshell activation", async () => {
  await withConsumerWorkspace("viberoots-init-no-direnv", async (workspace) => {
    const fakeBin = path.join(workspace, "fake-bin");
    await fsp.mkdir(fakeBin, { recursive: true });
    await fsp.symlink("/bin/bash", path.join(fakeBin, "bash"));
    await fsp.symlink(process.execPath, path.join(fakeBin, "node"));
    const pathWithoutDirenv = [fakeBin, "/bin", "/usr/bin"].join(path.delimiter);

    const { stdout, stderr } = await execFileAsync(path.join(workspace, "viberoots", "init"), [], {
      cwd: workspace,
      env: {
        ...process.env,
        PATH: pathWithoutDirenv,
        NO_DEV_SHELL: "",
      },
    });

    assert.match(stdout, /viberoots workspace initialized:/);
    assert.match(stderr, /direnv is not installed or not on PATH/);
    assert.equal(await fsp.readlink(path.join(workspace, ".viberoots", "current")), "../viberoots");
    assert.equal(
      (await fsp.stat(path.join(workspace, ".viberoots", "workspace"))).isDirectory(),
      true,
    );
  });
});
