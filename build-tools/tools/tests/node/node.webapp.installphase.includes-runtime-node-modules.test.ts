#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("node-webapp install phase preserves runtime node_modules only for SSR servers", async () => {
  const flakePkg = await fsp.readFile(
    "viberoots/build-tools/tools/nix/flake/packages/node-webapp.nix",
    "utf8",
  );
  if (!flakePkg.includes("printf '%s\\n' \"$WEBAPP_FRAMEWORK\" > .viberoots-webapp-framework")) {
    throw new Error(
      "node-webapp flake package must persist the resolved webapp framework for install-time behavior",
    );
  }
  if (!flakePkg.includes('if [ "$WEBAPP_FRAMEWORK" != "static" ]; then')) {
    throw new Error(
      "node-webapp flake package must skip runtime node_modules for static webapp outputs",
    );
  }
  if (!flakePkg.includes('ln -s "${nm}/node_modules" "$out/node_modules"')) {
    throw new Error(
      "node-webapp flake package must expose locked node_modules in the output for SSR runtime imports",
    );
  }

  const plannerPkg = await fsp.readFile(
    "viberoots/build-tools/tools/nix/planner/node-webapp.nix",
    "utf8",
  );
  if (!plannerPkg.includes("printf '%s\\n' \"$WEBAPP_FRAMEWORK\" > .viberoots-webapp-framework")) {
    throw new Error(
      "node-webapp planner package must persist the resolved webapp framework for install-time behavior",
    );
  }
  if (!plannerPkg.includes('if [ "$WEBAPP_FRAMEWORK" != "static" ]; then')) {
    throw new Error(
      "node-webapp planner package must skip runtime node_modules for static webapp outputs",
    );
  }
  if (!plannerPkg.includes('ln -s "${nm}/node_modules" "$out/node_modules"')) {
    throw new Error(
      "node-webapp planner package must expose locked node_modules in the output for SSR runtime imports",
    );
  }
});
