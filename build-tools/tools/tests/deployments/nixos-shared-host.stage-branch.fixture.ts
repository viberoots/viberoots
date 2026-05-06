#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { NixosSharedHostDeployment } from "../../deployments/contract";

export async function ensureNixosSharedHostStageBranch(
  cwd: string,
  $: any,
  deployment: Pick<NixosSharedHostDeployment, "lanePolicy" | "environmentStage">,
) {
  const branch = deployment.lanePolicy.stageBranches[deployment.environmentStage];
  await $({ cwd, stdio: "pipe" })`git branch -f ${branch} HEAD`;
  const remoteRoot = `${cwd}/.tmp-reviewed-origin.git`;
  const remotes = String((await $({ cwd, stdio: "pipe" })`git remote`).stdout || "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const hasOrigin = remotes.includes("origin");
  const hasBareRemote =
    (await fsp.stat(remoteRoot).catch(() => null))?.isDirectory() === true &&
    String(
      (
        await $({
          cwd,
          stdio: "pipe",
        })`git -C ${remoteRoot} rev-parse --is-bare-repository`.nothrow()
      ).stdout || "",
    ).trim() === "true";
  if (!hasBareRemote) {
    await fsp.rm(remoteRoot, { recursive: true, force: true }).catch(() => {});
    await $({ cwd, stdio: "pipe" })`git init --bare --initial-branch=main -q ${remoteRoot}`;
  }
  if (hasOrigin) {
    await $({ cwd, stdio: "pipe" })`git remote set-url origin ${remoteRoot}`;
  } else {
    await $({ cwd, stdio: "pipe" })`git remote add origin ${remoteRoot}`;
  }
  await $({ cwd, stdio: "pipe" })`git push --force origin HEAD:${branch}`;
  const originUrl = String(
    (await $({ cwd, stdio: "pipe" })`git remote get-url origin`).stdout || "",
  ).trim();
  if (!originUrl) throw new Error("reviewed-source fixture failed to configure origin remote");
  const advertised = await $({
    cwd,
    stdio: "pipe",
  })`git ls-remote --heads origin ${branch}`;
  if (!String(advertised.stdout || "").includes(`refs/heads/${branch}`)) {
    throw new Error(`reviewed-source fixture origin does not advertise ${branch}`);
  }
  const { repository = "", scmBackend = "" } = deployment.lanePolicy.governance || {};
  if (scmBackend.toLowerCase() === "github" && repository) {
    await $({
      cwd,
      stdio: "pipe",
    })`git config ${`url.${pathToFileURL(remoteRoot).href}.insteadOf`} ${`git@github.com:${repository}.git`}`;
  }
}
