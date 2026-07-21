#!/usr/bin/env zx-wrapper
import { ensureToolchainPathsFiles } from "./toolchain-paths";
import { repoRoot } from "../lib/repo";

ensureToolchainPathsFiles(repoRoot(), { refresh: true })
  .then(() => {
    console.log("toolchain paths ready");
  })
  .catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
  });
