import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { commandEnv } from "../viberoots/remote-consumer-boundary";
import { readPinnedSubmoduleConsumerLock } from "./rust.tauri-submodule-lock.fixture";

export async function activateTauriSubmodule(
  consumer: string,
  source: string,
  workspaceFlake: string,
  $: typeof globalThis.$,
): Promise<void> {
  const pinnedConsumerLock = await readPinnedSubmoduleConsumerLock(workspaceFlake);
  await $({
    cwd: consumer,
    env: {
      ...process.env,
      GIT_ALLOW_PROTOCOL: "file",
      WORKSPACE_ROOT: consumer,
    },
    stdio: "pipe",
  })`nix run --option eval-cache false --accept-flake-config path:${workspaceFlake}#viberoots -- use-submodule --workspace-root ${consumer} --url file://${source} --trust-url --no-direnv`;
  await fsp.writeFile(path.join(workspaceFlake, "flake.lock"), pinnedConsumerLock);
  assert.equal(
    await fsp.readFile(path.join(workspaceFlake, "flake.lock"), "utf8"),
    pinnedConsumerLock,
    "submodule activation did not restore the reviewed consumer lock",
  );
  assert.match(
    await fsp.readFile(path.join(consumer, ".gitmodules"), "utf8"),
    /file:\/\/\/nix\/store\//,
  );
  assert.equal(
    await fsp.realpath(path.join(consumer, ".viberoots", "current")),
    path.join(consumer, "viberoots"),
  );
  assert.match(
    await fsp.readFile(path.join(workspaceFlake, "flake.nix"), "utf8"),
    /path:\.\/viberoots-flake-input/,
  );
  await $({
    cwd: consumer,
    env: {
      ...commandEnv(consumer),
      GIT_ALLOW_PROTOCOL: "file",
    },
  })`viberoots init-consumer --mode submodule --workspace-root ${consumer} --source viberoots --no-direnv`;
}
