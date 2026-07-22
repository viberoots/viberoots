import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { PublicationSubject } from "./artifact-reproducibility-aggregate";
import { resolvePublicationSubjects } from "./publication-subject-authority";

export type ArtifactPublicationBinding = {
  subject: PublicationSubject;
  attr: "graph-generator-selected";
  target: string;
  flakeRef: string;
  bindingDigest: string;
};

export async function resolveArtifactPublicationBinding(opts: {
  subjectId: string;
  evaluationBundleRoot: string;
}): Promise<ArtifactPublicationBinding> {
  assertStoreRoot(opts.evaluationBundleRoot);
  const graph = JSON.parse(
    await fs.readFile(path.join(opts.evaluationBundleRoot, "graph.json"), "utf8"),
  ) as unknown;
  const subjects = resolvePublicationSubjects(graph);
  const subject = subjects.find(({ subjectId }) => subjectId === opts.subjectId);
  if (!subject)
    throw new Error(`production graph does not authorize publication subject ${opts.subjectId}`);
  const selection = JSON.parse(
    await fs.readFile(path.join(opts.evaluationBundleRoot, "selection.json"), "utf8"),
  ) as { attr?: unknown; target?: unknown };
  if (selection.attr !== "graph-generator-selected" || selection.target !== subject.target) {
    throw new Error(`publication bundle selection must bind ${subject.target}`);
  }
  const flakeSubdir = (await exists(
    path.join(opts.evaluationBundleRoot, "source/.viberoots/workspace/flake.nix"),
  ))
    ? "source/.viberoots/workspace"
    : "source";
  const authority = { attr: "graph-generator-selected" as const, subject, target: subject.target };
  return {
    ...authority,
    flakeRef: `path:${opts.evaluationBundleRoot}?dir=${flakeSubdir}#graph-generator-selected`,
    bindingDigest: digest(authority),
  };
}

async function exists(file: string): Promise<boolean> {
  return await fs.access(file).then(
    () => true,
    () => false,
  );
}

function assertStoreRoot(value: string): void {
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(value)) {
    throw new Error("publication binding requires an immutable evaluation-bundle root");
  }
}

function digest(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
