import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  commitAll,
  createFreshCloneFixture,
  git,
  requiredTrackedInputs,
} from "./fresh-clone-post-clone.fixture";

type Fixture = Awaited<ReturnType<typeof createFreshCloneFixture>>;

export async function assertStalePostCloneCases(fixture: Fixture): Promise<void> {
  const { consumerSource, localGitEnv } = fixture;
  const canonical = new Map(
    await Promise.all(
      requiredTrackedInputs.map(
        async (rel) => [rel, await fsp.readFile(path.join(consumerSource, rel), "utf8")] as const,
      ),
    ),
  );
  await fsp.writeFile(path.join(consumerSource, ".envrc"), "stale generated envrc\n");
  await commitAll(consumerSource, "fixture: stale generated metadata", localGitEnv);
  const staleClone = await fixture.clone("stale-clone");
  const staleEnvrc = await fsp.readFile(path.join(staleClone, ".envrc"));
  await assert.rejects(
    fixture.postClone(staleClone),
    /post-clone found stale tracked generated file \.envrc[\s\S]*no tracked files were modified[\s\S]*repair: run viberoots update/,
  );
  assert.deepEqual(await fsp.readFile(path.join(staleClone, ".envrc")), staleEnvrc);
  assert.equal(await git(staleClone, ["status", "--short"]), "");
  await assert.rejects(fsp.lstat(path.join(staleClone, ".viberoots/workspace/backups")), {
    code: "ENOENT",
  });
  await fixture.cleanupClone(staleClone);

  for (const [rel, content] of canonical)
    await fsp.writeFile(path.join(consumerSource, rel), content);
  const current = canonical.get(".buckconfig")!;
  const legacy = current.replace(
    "prelude = ./.viberoots/workspace/prelude",
    "prelude = ./.viberoots/current/prelude",
  );
  assert.notEqual(legacy, current);
  await fsp.writeFile(path.join(consumerSource, ".buckconfig"), legacy);
  await commitAll(consumerSource, "fixture: stale legacy buckconfig", localGitEnv);
  const legacyClone = await fixture.clone("stale-legacy-clone");
  await assert.rejects(
    fixture.postClone(legacyClone),
    /stale tracked generated file \.buckconfig[\s\S]*no tracked files were modified[\s\S]*viberoots update/,
  );
  assert.equal(await git(legacyClone, ["status", "--short"]), "");
  await fixture.cleanupClone(legacyClone);

  for (const [rel, content] of canonical)
    await fsp.writeFile(path.join(consumerSource, rel), content);
  await assertStalePnpmPostCloneCase(fixture);
}

export async function assertStalePnpmPostCloneCase(fixture: Fixture): Promise<void> {
  const { consumerSource, localGitEnv } = fixture;
  const importer = path.join(consumerSource, "projects/apps/stale-pnpm");
  await fsp.mkdir(importer, { recursive: true });
  await fsp.writeFile(
    path.join(importer, "package.json"),
    `${JSON.stringify({ name: "stale-pnpm", private: true, dependencies: { "left-pad": "1.3.0" } }, null, 2)}\n`,
  );
  await fsp.writeFile(
    path.join(importer, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n",
  );
  await commitAll(consumerSource, "fixture: stale pnpm metadata", localGitEnv);
  const pnpmClone = await fixture.clone("stale-pnpm-clone");
  const lock = path.join(pnpmClone, "projects/apps/stale-pnpm/pnpm-lock.yaml");
  const before = await fsp.readFile(lock);
  await assert.rejects(
    fixture.postClone(pnpmClone, {
      runInstall: true,
      lockfile: "projects/apps/stale-pnpm/pnpm-lock.yaml",
    }),
    /tracked metadata is stale: projects\/apps\/stale-pnpm\/pnpm-lock\.yaml[\s\S]*no tracked files were modified[\s\S]*repair: run u/,
  );
  assert.deepEqual(await fsp.readFile(lock), before);
  assert.equal(await git(pnpmClone, ["status", "--short"]), "");
  await fixture.cleanupClone(pnpmClone);
}
