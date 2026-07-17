#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { NixosSharedHostDeployment } from "../../deployments/contract";

export function deploymentSourceRef(
  deployment: Pick<NixosSharedHostDeployment, "lanePolicy" | "environmentStage">,
): string {
  const sourceRef = deployment.lanePolicy.sourceRefPolicy[deployment.environmentStage];
  if (!sourceRef) {
    throw new Error(
      `reviewed-source fixture missing source ref for ${deployment.environmentStage}`,
    );
  }
  return sourceRef;
}

function materializedSourceRef(
  deployment: Pick<NixosSharedHostDeployment, "lanePolicy" | "environmentStage">,
): string {
  const sourceRef = deploymentSourceRef(deployment);
  if (!sourceRef.includes("*")) return sourceRef;
  const concreteRef = sourceRef.replace(/\*/g, "fixture");
  deployment.lanePolicy.sourceRefPolicy[deployment.environmentStage] = concreteRef;
  return concreteRef;
}

export async function ensureNixosSharedHostReviewedSourceRef(
  cwd: string,
  $: any,
  deployment: Pick<NixosSharedHostDeployment, "lanePolicy" | "environmentStage">,
) {
  const sourceRef = materializedSourceRef(deployment);
  const remoteRef = sourceRef.startsWith("refs/") ? sourceRef : `refs/heads/${sourceRef}`;
  const localBranch = remoteRef.startsWith("refs/heads/")
    ? remoteRef.slice("refs/heads/".length)
    : "";
  const currentBranch = String(
    (await $({ cwd, stdio: "pipe" })`git branch --show-current`).stdout || "",
  ).trim();
  if (localBranch && currentBranch !== localBranch) {
    await $({ cwd, stdio: "pipe" })`git branch -f ${localBranch} HEAD`;
  }
  await $({ cwd, stdio: "pipe" })`git update-ref ${remoteRef} HEAD`;
  const gitDirRaw = String(
    (await $({ cwd, stdio: "pipe" })`git rev-parse --git-common-dir`).stdout || "",
  ).trim();
  if (!gitDirRaw) throw new Error("reviewed-source fixture could not resolve its Git directory");
  const gitDir = path.isAbsolute(gitDirRaw) ? gitDirRaw : path.resolve(cwd, gitDirRaw);
  const remoteRoot = path.join(gitDir, "viberoots-reviewed-origin.git");
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
  await $({ cwd, stdio: "pipe" })`git push --force origin HEAD:${remoteRef}`;
  const originUrl = String(
    (await $({ cwd, stdio: "pipe" })`git remote get-url origin`).stdout || "",
  ).trim();
  if (!originUrl) throw new Error("reviewed-source fixture failed to configure origin remote");
  const advertised = await $({
    cwd,
    stdio: "pipe",
  })`git ls-remote origin ${remoteRef}`;
  if (!String(advertised.stdout || "").includes(remoteRef)) {
    throw new Error(`reviewed-source fixture origin does not advertise ${remoteRef}`);
  }
  const { repository = "", scmBackend = "" } = deployment.lanePolicy.governance || {};
  if (scmBackend.toLowerCase() === "github" && repository) {
    await $({
      cwd,
      stdio: "pipe",
    })`git config ${`url.${pathToFileURL(remoteRoot).href}.insteadOf`} ${`git@github.com:${repository}.git`}`;
  }
}
