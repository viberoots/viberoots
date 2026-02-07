#!/usr/bin/env zx-wrapper
import { ensureToolchainPathsFiles } from "./toolchain-paths.ts";
import { repoRoot } from "../lib/repo.ts";

ensureToolchainPathsFiles(repoRoot())
  .then(() => {
    console.log("toolchain paths ready");
  })
  .catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
  });
