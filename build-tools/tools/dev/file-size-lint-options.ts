#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagList, getFlagStr } from "../lib/cli.ts";
import {
  DEPLOYMENT_DOMAIN_FILES_SCOPE,
  SOURCE_FILES_SCOPE,
  SSR_TEST_FILES_SCOPE,
  type FileSizeScope,
} from "./file-size-lint-scopes.ts";

export type FileSizeLintOptions = {
  root: string;
  changedOnly: boolean;
  threshold: number;
  failOnOffenders: boolean;
  allowKnown: boolean;
  scope: FileSizeScope;
};

export function parseFileSizeLintArgs(): FileSizeLintOptions {
  const root = path.resolve(getFlagStr("root", process.cwd()));
  const changedOnly = getFlagBool("changed-only") || getFlagBool("changedOnly");
  const threshold = Number(getFlagStr("threshold", "250"));
  const failOnOffenders = getFlagBool("fail");
  const allowKnown = getFlagBool("allow-known");
  const scopeName = getFlagStr("scope", "");
  const include = getFlagList("include");
  const exclude = getFlagList("exclude");

  if (scopeName === "source") {
    return {
      root,
      changedOnly,
      threshold,
      failOnOffenders,
      allowKnown,
      scope: {
        include: include.length ? include : SOURCE_FILES_SCOPE.include,
        exclude: exclude.length ? exclude : SOURCE_FILES_SCOPE.exclude,
      },
    };
  }
  if (scopeName === "ssr-tests") {
    return {
      root,
      changedOnly,
      threshold,
      failOnOffenders,
      allowKnown: false,
      scope: {
        include: include.length ? include : SSR_TEST_FILES_SCOPE.include,
        exclude: exclude.length ? exclude : SSR_TEST_FILES_SCOPE.exclude,
      },
    };
  }
  if (scopeName === "deployment-domain") {
    return {
      root,
      changedOnly,
      threshold,
      failOnOffenders,
      allowKnown: false,
      scope: {
        include: include.length ? include : DEPLOYMENT_DOMAIN_FILES_SCOPE.include,
        exclude: exclude.length ? exclude : DEPLOYMENT_DOMAIN_FILES_SCOPE.exclude,
      },
    };
  }

  const legacyExts = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".bzl", ".nix"]);
  const legacyInclude =
    include.length > 0 ? include : Array.from(legacyExts).map((ext) => `**/*${ext}`);

  return {
    root,
    changedOnly,
    threshold,
    failOnOffenders,
    allowKnown,
    scope: { include: legacyInclude, exclude },
  };
}
