#!/usr/bin/env zx-wrapper
import "zx/globals";
import { runInTemp } from "../lib/test-helpers";

void (async function main() {
  console.log("TAP version 13");
  const res = await runInTemp("dev-build-no-staging", async (tmp, $tmp) => {
    // Initialize a git repo to observe index changes
    await $tmp`git init -q`;
    await $tmp`git config user.email test@example.com`;
    await $tmp`git config user.name test`;
    await $tmp`git add -A && git commit -qm init`;

    // Refresh glue and build via the helper
    await $tmp({
      env: {
        ...process.env,
        DEV_BUILD_LOW_SPACE_GB: "0",
      },
    })`build-tools/tools/dev/dev-build.ts build //... --no-materialize`;

    // Ensure no index changes occurred
    const { stdout } = await $tmp`git status --porcelain`;
    console.log("# git porcelain:", String(stdout || "").trim());
    if (String(stdout || "").trim() !== "") {
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
