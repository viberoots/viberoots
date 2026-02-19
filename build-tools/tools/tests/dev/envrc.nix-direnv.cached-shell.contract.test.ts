#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test(".envrc uses nix-direnv loading path and keeps use flake", async () => {
  const txt = await fsp.readFile(".envrc", "utf8");
  if (!txt.includes('source "${__nix_direnv_direnvrc}"')) {
    throw new Error(".envrc must source nix-direnv direnvrc");
  }
  if (!txt.includes("use flake")) {
    throw new Error(".envrc must use flake through nix-direnv");
  }
});

test(".envrc preserves required local-only NIX_CONFIG guardrails", async () => {
  const txt = await fsp.readFile(".envrc", "utf8");
  if (!txt.includes("builders =")) {
    throw new Error(".envrc must preserve local-only builders guardrail");
  }
  if (!txt.includes("build-hook =")) {
    throw new Error(".envrc must preserve build-hook override");
  }
  if (!txt.includes("max-jobs = auto")) {
    throw new Error(".envrc must preserve max-jobs guardrail");
  }
  if (!txt.includes("warn-dirty = false")) {
    throw new Error(".envrc must preserve warn-dirty guardrail");
  }
});

test(".envrc fails explicitly when nix-direnv is missing", async () => {
  const txt = await fsp.readFile(".envrc", "utf8");
  if (!txt.includes("error: nix-direnv is required for this repository shell cache path.")) {
    throw new Error(".envrc must include explicit missing nix-direnv failure text");
  }
  if (!txt.includes("install: nix profile install nixpkgs#nix-direnv")) {
    throw new Error(".envrc must include setup guidance for nix-direnv");
  }
  if (!txt.includes("return 1")) {
    throw new Error(".envrc missing-dependency path must fail");
  }
});
