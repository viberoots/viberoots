import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { runInTemp } from "../lib/test-helpers/run-in-temp";
import { ensureNixStoreToolPathSync } from "../../lib/tool-paths";

const execFileAsync = promisify(execFile);
const gitIdentity = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

async function assertGitClean(root: string): Promise<void> {
  const [{ stdout: diff }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["diff", "--no-ext-diff"], { cwd: root }),
    execFileAsync("git", ["status", "--short"], { cwd: root }),
  ]);
  assert.equal(diff, "", `tracked diff after read-only command:\n${diff}`);
  await execFileAsync("git", ["diff", "--exit-code"], { cwd: root });
  assert.equal(status, "", `status after read-only command:\n${status}`);
}

async function commitFixture(
  root: string,
  files: string | string[],
  message: string,
): Promise<void> {
  await execFileAsync("git", ["add", ...(Array.isArray(files) ? files : [files])], { cwd: root });
  await execFileAsync("git", [...gitIdentity, "commit", "-qm", message], { cwd: root });
}

async function configureIgnoredMaterialization(root: string): Promise<void> {
  await fsp.appendFile(
    path.join(root, ".git/info/exclude"),
    "\n.viberoots/\nviberoots/.viberoots/\n",
  );
  await execFileAsync(
    "git",
    ["rm", "-r", "--cached", "--ignore-unmatch", ".viberoots", "viberoots/.viberoots"],
    { cwd: root },
  );
  await fsp.rm(path.join(root, "viberoots/.viberoots"), { recursive: true, force: true });
  await assert.rejects(fsp.access(path.join(root, "viberoots/.viberoots")));
}

async function commitSeedOverlay(root: string): Promise<void> {
  await configureIgnoredMaterialization(root);
  await execFileAsync("git", ["add", "-A"], { cwd: root });
  await execFileAsync("git", [...gitIdentity, "commit", "-qm", "test: fixture baseline"], {
    cwd: root,
  });
}

test("real i and post-clone preserve tracked state on current and stale metadata", async () => {
  await runInTemp("read-only-commands-clean", async (root) => {
    await configureIgnoredMaterialization(root);
    const install = path.join(root, "viberoots/build-tools/tools/bin/i");
    const installArgs = ["--without-secrets", "--skip-glue", "--skip-go-tidy"];
    const { stdout: lockfiles } = await execFileAsync("git", ["ls-files", "*pnpm-lock.yaml"], {
      cwd: root,
    });
    for (const lockfile of lockfiles.trim().split("\n").filter(Boolean)) {
      await fsp.rm(path.join(root, lockfile));
    }
    await execFileAsync(install, installArgs, {
      cwd: root,
      env: { ...process.env, WORKSPACE_ROOT: root, VBR_INSTALL_REFRESH_PNPM_HASHES: "1" },
    });
    await commitSeedOverlay(root);
    await assertGitClean(root);
    await execFileAsync(install, installArgs, {
      cwd: root,
      env: { ...process.env, WORKSPACE_ROOT: root },
    });
    await assertGitClean(root);

    const project = path.join(root, "projects/apps/stale-python");
    await fsp.mkdir(project, { recursive: true });
    const manifest = path.join(project, "pyproject.toml");
    await fsp.writeFile(
      manifest,
      "[project]\nname='stale-python'\nversion='0.0.0'\nrequires-python='>=3.11'\n",
    );
    await execFileAsync(ensureNixStoreToolPathSync("uv"), ["lock"], { cwd: project });
    await commitFixture(root, [manifest, path.join(project, "uv.lock")], "test: valid uv metadata");
    await fsp.appendFile(manifest, "dependencies=['idna==3.10']\n");
    await commitFixture(root, manifest, "test: stale uv metadata");
    await assert.rejects(
      execFileAsync(install, installArgs, {
        cwd: root,
        env: { ...process.env, WORKSPACE_ROOT: root },
      }),
    );
    await assertGitClean(root);

    const command = path.join(root, "viberoots/build-tools/tools/bin/viberoots");
    const bootstrap = path.join(root, "viberoots/bootstrap");
    const fakeBin = path.join(root, ".test-bin");
    await fsp.mkdir(fakeBin, { recursive: true });
    for (const tool of ["xcode-select", "xcrun"]) {
      await fsp.writeFile(path.join(fakeBin, tool), "#!/usr/bin/env bash\nexit 0\n", {
        mode: 0o755,
      });
    }
    const env = {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
      NO_DEV_SHELL: "1",
      VBR_RUN_INSTALL: "0",
      VBR_DIRENV_ALLOW: "0",
    };
    const args = [
      "post-clone",
      "--bootstrap-url",
      `file://${bootstrap}`,
      "--trust-bootstrap-url",
      "--workspace-root",
      root,
      "--mode",
      "flake",
    ];
    await execFileAsync(bootstrap, [], { cwd: root, env: { ...env, VBR_WORKSPACE_ROOT: root } });
    await commitSeedOverlay(root);
    await assertGitClean(root);
    await execFileAsync(command, args, { cwd: root, env });
    await assertGitClean(root);

    const lock = path.join(root, "flake.lock");
    const parsed = JSON.parse(await fsp.readFile(lock, "utf8"));
    parsed.nodes.viberoots.locked.rev = "stale";
    await fsp.writeFile(lock, `${JSON.stringify(parsed, null, 2)}\n`);
    await commitFixture(root, lock, "test: stale post-clone lock");
    await assert.rejects(execFileAsync(command, args, { cwd: root, env }), /locked\.rev/);
    await assertGitClean(root);
  });
});
