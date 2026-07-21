#!/usr/bin/env zx-wrapper
import "zx/globals";
import { runInTemp } from "../lib/test-helpers";
import { buildToolPath } from "../../dev/dev-build/paths";
import { ensureBuckPreludeConfig } from "../../dev/dev-build/prelude";
import { withoutArtifactEnvironmentInfluence } from "../../lib/artifact-environment";

void (async function main() {
  console.log("TAP version 13");
  const res = await runInTemp("dev-build-no-staging", async (tmp, $tmp) => {
    const devBuild = buildToolPath(process.cwd(), "tools/dev/dev-build.ts");
    // Initialize a git repo to observe index changes
    await $tmp`git init -q`;
    await $tmp`git config user.email test@example.com`;
    await $tmp`git config user.name test`;
    await ensureBuckPreludeConfig(tmp);
    await $tmp`git add -A`;
    await $tmp`git rm -rq --cached --ignore-unmatch .viberoots`;
    await $tmp`git commit -qm init`;

    // Refresh glue and build via the helper
    await $tmp({
      env: {
        ...withoutArtifactEnvironmentInfluence(process.env),
        DEV_BUILD_LOW_SPACE_GB: "0",
      },
    })`${devBuild} build //.viberoots/workspace:flake.lock --no-materialize`;

    const { stdout: staged } = await $tmp`git diff --cached --name-only`;
    const { stdout: tracked } = await $tmp`git status --porcelain --untracked-files=no`;
    const changed = [staged, tracked].map((value) => String(value || "").trim()).filter(Boolean);
    console.log("# git staged/tracked:", changed.join("\n"));
    if (changed.length > 0) {
      console.log("not ok 1 - dev-build mutated git index");
      console.log("  ---\n  diag: git index changed\n  ...");
      return false;
    }
    console.log("ok 1 - dev-build does not stage or reset glue files");
    return true;
  });
  console.log("1..1");
  if (!res) process.exit(1);
})();
