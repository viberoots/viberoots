#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagList, getFlagStr } from "../lib/cli";
import { SOURCE_FILES_SCOPE, type FileSizeScope } from "./file-size-lint-scopes";

export type FileSizeLintOptions = {
  root: string;
  changedOnly: boolean;
  threshold: number;
  failOnOffenders: boolean;
  allowKnown: boolean;
  scope: FileSizeScope;
};

function sourceScope(include: string[], exclude: string[]): FileSizeScope {
  return {
    include: include.length ? include : SOURCE_FILES_SCOPE.include,
    exclude: exclude.length ? exclude : SOURCE_FILES_SCOPE.exclude,
  };
}

export function parseFileSizeLintArgs(): FileSizeLintOptions {
  const root = path.resolve(getFlagStr("root", process.cwd()));
  const changedOnly = getFlagBool("changed-only") || getFlagBool("changedOnly");
  const threshold = Number(getFlagStr("threshold", "250"));
  const failOnOffenders = getFlagBool("fail");
  const allowKnown = getFlagBool("allow-known");
  const scopeName = getFlagStr("scope", "");
  const include = getFlagList("include");
  const exclude = getFlagList("exclude");

  if (scopeName === "source" || scopeName === "ssr-tests" || scopeName === "deployment-domain") {
    return {
      root,
      changedOnly,
      threshold,
      failOnOffenders,
      allowKnown,
      scope: sourceScope(include, exclude),
    };
  }

  const defaultExts = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".cjs",
    ".bzl",
    ".py",
    ".go",
    ".rs",
    ".nix",
  ]);
  const defaultInclude =
    include.length > 0 ? include : Array.from(defaultExts).map((ext) => `**/*${ext}`);

  return {
    root,
    changedOnly,
    threshold,
    failOnOffenders,
    allowKnown,
    scope: { include: defaultInclude, exclude },
  };
}
