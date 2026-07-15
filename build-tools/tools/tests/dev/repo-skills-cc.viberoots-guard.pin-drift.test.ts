import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { checkConsumerConsistency } from "../../dev/consumer-consistency-check";
import { buckconfig } from "../../lib/consumer-bootstrap";
import { consumerGitignoreEntries } from "../../lib/consumer-tracked-inputs";
import { ccFixture, commitEnv, execFileAsync } from "./repo-skills-cc.viberoots-guard.fixture";

test("cc consistency guard classifies pin and dependency drift with exact repair commands", async () => {
  const root = await ccFixture("submodule");
  try {
    const checkout = path.join(root, "viberoots");
    await fsp.mkdir(checkout, { recursive: true });
    await execFileAsync("git", ["init", "-q"], { cwd: checkout });
    await fsp.writeFile(path.join(checkout, "VERSION"), "old\n");
    await execFileAsync("git", ["add", "VERSION"], { cwd: checkout });
    await execFileAsync("git", ["commit", "-qm", "old"], { cwd: checkout, env: commitEnv });
    const { stdout: oldStdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: checkout,
    });
    const oldRev = oldStdout.trim();
    await fsp.writeFile(path.join(checkout, "VERSION"), "new\n");
    await execFileAsync("git", ["add", "VERSION"], { cwd: checkout });
    await execFileAsync("git", ["commit", "-qm", "new"], { cwd: checkout, env: commitEnv });
    const { stdout: newStdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: checkout,
    });
    const newRev = newStdout.trim();
    await execFileAsync(
      "git",
      ["update-index", "--add", "--cacheinfo", `160000,${oldRev},viberoots`],
      { cwd: root },
    );
    await fsp.writeFile(
      path.join(root, "flake.lock"),
      `${JSON.stringify({ nodes: { viberoots: { locked: { rev: newRev } } } })}\n`,
    );
    await checkConsumerConsistency(root, {
      checkPnpm: async () => {},
      checkLanguages: async () => {},
    });

    await fsp.writeFile(
      path.join(root, "flake.lock"),
      `${JSON.stringify({ nodes: { viberoots: { locked: { rev: oldRev } } } })}\n`,
    );
    await assert.rejects(
      checkConsumerConsistency(root, {
        checkPnpm: async () => {},
        checkLanguages: async () => {},
      }),
      new RegExp(
        `prospective viberoots gitlink ${newRev} does not match flake\\.lock ${oldRev}[\\s\\S]*repair: run viberoots update`,
      ),
    );

    await execFileAsync("git", ["checkout", "-q", oldRev], { cwd: checkout });
    await fsp.writeFile(
      path.join(root, "flake.lock"),
      `${JSON.stringify({ nodes: { viberoots: { locked: { rev: newRev } } } })}\n`,
    );
    await assert.rejects(
      checkConsumerConsistency(root, {
        checkPnpm: async () => {},
        checkLanguages: async () => {},
      }),
      new RegExp(
        `prospective viberoots gitlink ${oldRev} does not match flake\\.lock ${newRev}[\\s\\S]*repair: run viberoots update`,
      ),
    );

    await execFileAsync("git", ["update-index", "--force-remove", "viberoots"], { cwd: root });
    await fsp.rm(checkout, { recursive: true, force: true });
    await fsp.writeFile(
      path.join(root, "flake.nix"),
      'inputs.viberoots.url = "github:viberoots/viberoots/pinned";\n',
    );
    await fsp.writeFile(path.join(root, ".buckconfig"), buckconfig("flake"));
    await assert.rejects(
      checkConsumerConsistency(root, {
        checkPnpm: async () => {
          throw new Error("error: stale pnpm metadata\n\nrepair: run u");
        },
        checkLanguages: async () => {},
      }),
      /repair: run u/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("cc guard rejects dirty generated consumer state", async () => {
  const root = await ccFixture("flake");
  const opts = { checkPnpm: async () => {}, checkLanguages: async () => {} };
  try {
    for (const [rel, stale, restore] of [
      [".buckroot", "stale\n", ".\n"],
      [".buckconfig", "stale\n", buckconfig("flake")],
      [
        ".gitignore",
        ".viberoots/\n",
        `# viberoots local workspace state\n${consumerGitignoreEntries.join("\n")}\n`,
      ],
    ] as const) {
      await fsp.writeFile(path.join(root, rel), stale);
      await assert.rejects(
        checkConsumerConsistency(root, opts),
        new RegExp(`stale generated file ${rel.replaceAll(".", "\\.")}[\\s\\S]*viberoots update`),
      );
      await fsp.writeFile(path.join(root, rel), restore);
    }

    await fsp.mkdir(path.join(root, "projects/config"), { recursive: true });
    await fsp.writeFile(path.join(root, "projects/config/local.json"), "{}\n");
    await execFileAsync("git", ["add", "-f", "projects/config/local.json"], { cwd: root });
    await assert.rejects(
      checkConsumerConsistency(root, opts),
      /stale generated file projects\/config\/local\.json[\s\S]*viberoots update/,
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
