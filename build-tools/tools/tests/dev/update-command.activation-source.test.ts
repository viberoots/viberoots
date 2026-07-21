import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { updateActivationSource } from "../../dev/update-command/run";
import type { GitRunner } from "../../lib/consumer-source-mode";

const immutableSource = "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-source";

function gitRunnerWithTrackedSubmodule(): GitRunner {
  return async (args) => {
    const command = args.join(" ");
    if (command.includes("get-regexp")) {
      return { stdout: "submodule.viberoots.path viberoots\n", stderr: "" };
    }
    if (command.includes("submodule.viberoots.url")) {
      return { stdout: "https://github.com/viberoots/viberoots.git\n", stderr: "" };
    }
    if (command === "ls-files -s viberoots") {
      return {
        stdout: "160000 0123456789012345678901234567890123456789 0\tviberoots\n",
        stderr: "",
      };
    }
    return { stdout: "", stderr: "" };
  };
}

test("update activation keeps a tracked submodule live", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-update-activation-"));
  try {
    await fsp.mkdir(path.join(root, "viberoots"));
    assert.equal(
      await updateActivationSource(root, immutableSource, gitRunnerWithTrackedSubmodule()),
      path.join(root, "viberoots"),
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("update activation uses immutable authority without a tracked submodule", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-update-activation-"));
  try {
    const emptyGit: GitRunner = async () => ({ stdout: "", stderr: "" });
    assert.equal(await updateActivationSource(root, immutableSource, emptyGit), immutableSource);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
