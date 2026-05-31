import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  verifyCredentialFileSet,
  verifyLiveCredentialHostMount,
} from "../../deployments/control-plane-credential-host-verifier";
import { runInScratchTemp } from "../lib/test-helpers";

const REQUIRED = ["control-plane-token", "control-plane-database-url"];

test("host verifier refuses non-target local directories", async () => {
  await runInScratchTemp("credential-host-verify", async (tmp) => {
    const dir = await credentialDir(tmp);
    await assert.rejects(
      () => verifyLiveCredentialHostMount({ credentialDirectory: dir, requiredFiles: REQUIRED }),
      /must inspect \/run\/deployment-control-plane\/credentials/,
    );
    await assert.rejects(
      () =>
        verifyLiveCredentialHostMount({
          credentialDirectory: dir,
          requiredFiles: REQUIRED,
          targetPath: "/tmp/credentials",
        }),
      /target must be \/run\/deployment-control-plane\/credentials/,
    );
  });
});

test("host verifier fails closed for filesystem and AWS wiring mismatches", async () => {
  await runInScratchTemp("credential-host-verify-negative", async (tmp) => {
    const cases: Array<[string, (dir: string) => Promise<void>, RegExp]> = [
      ["missing", async (dir) => fsp.rm(path.join(dir, REQUIRED[0]!)), /filename set/],
      ["extra", async (dir) => writeCredential(path.join(dir, "extra")), /filename set/],
      ["writable", async (dir) => fsp.chmod(path.join(dir, REQUIRED[0]!), 0o600), /0400/],
      ["symlink", async (dir) => replaceWithSymlink(dir, REQUIRED[0]!), /regular file/],
    ];
    for (const [name, mutate, pattern] of cases) {
      const dir = await credentialDir(path.join(tmp, name));
      const expectedOwner = await owner(dir);
      await mutate(dir);
      await assert.rejects(async () => verifyFileSet(dir, expectedOwner), pattern);
    }
    const dir = await credentialDir(path.join(tmp, "aws"));
    const wrongOwner = await owner(dir);
    wrongOwner.uid += 1;
    await assert.rejects(() => verifyFileSet(dir, wrongOwner), /ownership/);
  });
});

async function credentialDir(root: string): Promise<string> {
  const dir = path.join(root, "credentials");
  await fsp.mkdir(dir, { recursive: true });
  for (const name of REQUIRED) await writeCredential(path.join(dir, name));
  return dir;
}

async function writeCredential(file: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, "placeholder\n", { mode: 0o400 });
  await fsp.chmod(file, 0o400);
}

async function replaceWithSymlink(dir: string, name: string): Promise<void> {
  await fsp.rm(path.join(dir, name));
  await fsp.symlink(path.join(dir, REQUIRED[1]!), path.join(dir, name));
}

async function verifyFileSet(dir: string, expectedOwner: { uid: number; gid: number }) {
  await verifyCredentialFileSet({
    root: dir,
    realRoot: await fsp.realpath(dir),
    names: await fsp.readdir(dir),
    expected: [...REQUIRED].sort(),
    owner: expectedOwner,
  });
}

async function owner(dir: string): Promise<{ uid: number; gid: number }> {
  const stat = await fsp.stat(path.join(dir, REQUIRED[0]!));
  return { uid: stat.uid, gid: stat.gid };
}
