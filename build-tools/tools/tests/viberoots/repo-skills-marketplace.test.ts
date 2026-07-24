import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeRepoSkillsMarketplace } from "../../lib/repo-skills-marketplace";

async function workspace(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "vbr-repo-skills-marketplace-"));
}

async function readMarketplace(root: string) {
  return JSON.parse(
    await readFile(path.join(root, ".agents", "plugins", "marketplace.json"), "utf8"),
  ) as {
    name: string;
    plugins: Array<Record<string, unknown>>;
  };
}

test("writes the repo-local Repo Skills marketplace idempotently", async () => {
  const root = await workspace();
  await writeRepoSkillsMarketplace(root);
  const first = await readMarketplace(root);
  await writeRepoSkillsMarketplace(root);
  const second = await readMarketplace(root);

  assert.deepEqual(second, first);
  assert.equal(first.name, "repo-plugins");
  assert.deepEqual(first.plugins, [
    {
      name: "repo-skills",
      source: {
        source: "local",
        path: "./.viberoots/current/plugins/repo-skills",
      },
      policy: {
        installation: "INSTALLED_BY_DEFAULT",
        authentication: "ON_INSTALL",
      },
      category: "Productivity",
    },
  ]);
});

test("preserves other marketplace entries while repairing Repo Skills", async () => {
  const root = await workspace();
  const file = path.join(root, ".agents", "plugins", "marketplace.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({
      name: "consumer-tools",
      interface: { displayName: "Consumer Tools", extra: true },
      plugins: [
        { name: "other-plugin", source: "./plugins/other", custom: true },
        { name: "repo-skills", source: "./stale", custom: true },
      ],
    })}\n`,
  );

  await writeRepoSkillsMarketplace(root);
  const result = await readMarketplace(root);

  assert.equal(result.name, "consumer-tools");
  assert.equal(result.plugins.length, 2);
  assert.deepEqual(result.plugins[0], {
    name: "other-plugin",
    source: "./plugins/other",
    custom: true,
  });
  assert.deepEqual(result.plugins[1], {
    name: "repo-skills",
    source: {
      source: "local",
      path: "./.viberoots/current/plugins/repo-skills",
    },
    policy: {
      installation: "INSTALLED_BY_DEFAULT",
      authentication: "ON_INSTALL",
    },
    category: "Productivity",
    custom: true,
  });
});

test("fails closed on malformed marketplace metadata", async () => {
  const root = await workspace();
  const file = path.join(root, ".agents", "plugins", "marketplace.json");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "{not-json\n");

  await assert.rejects(
    writeRepoSkillsMarketplace(root),
    /marketplace\.json is not valid JSON.*fix or remove/s,
  );
  assert.equal(await readFile(file, "utf8"), "{not-json\n");
});
