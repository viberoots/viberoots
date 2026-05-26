#!/usr/bin/env zx-wrapper
import { createHash } from "node:crypto";
import { readFlagStrFromTokens } from "../lib/argv";
import type { SprinkleRefStore } from "./sprinkleref-types";

type FingerprintAlgorithm = "sha256" | "sha512";

export async function renderSprinkleRefFingerprint(opts: {
  argv: string[];
  ref: string;
  category: string;
  store: SprinkleRefStore;
}) {
  const algorithm = readFingerprintAlgorithm(opts.argv);
  const value = await opts.store.read(opts.ref);
  if (value === undefined) throw new Error(`${opts.ref} is missing`);
  return renderFingerprint(
    {
      ref: opts.ref,
      category: opts.category,
      backend: opts.store.describe(),
      algorithm,
      digest: createHash(algorithm).update(value, "utf8").digest("hex"),
    },
    readFlagStrFromTokens("format", "human", opts.argv).trim(),
  );
}

function readFingerprintAlgorithm(argv: string[]): FingerprintAlgorithm {
  const algorithm = readFlagStrFromTokens("algorithm", "sha256", argv).trim();
  if (algorithm === "sha256" || algorithm === "sha512") return algorithm;
  throw new Error("--algorithm must be sha256 or sha512");
}

function renderFingerprint(
  result: {
    ref: string;
    category: string;
    backend: string;
    algorithm: FingerprintAlgorithm;
    digest: string;
  },
  format: string,
) {
  if (format === "json") {
    return JSON.stringify(
      {
        schemaVersion: "sprinkleref-fingerprint@1",
        sensitive: false,
        secretValuePrinted: false,
        ...result,
      },
      null,
      2,
    );
  }
  if (format !== "human") throw new Error("--format must be human or json");
  return [
    `SprinkleRef fingerprint`,
    `ref: ${result.ref}`,
    `category: ${result.category}`,
    `backend: ${result.backend}`,
    `${result.algorithm}: ${result.digest}`,
  ].join("\n");
}
