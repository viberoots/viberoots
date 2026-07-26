import * as fsp from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const BINDING_RE = /^[0-9a-f]{64}$/u;
const ISOLATION_RE = /^[A-Za-z0-9._-]+$/u;
const SUFFIX = "-artifact-cache-";

type IsolationState = {
  binding: string;
  isolation: string;
};

function assertBinding(binding: string): void {
  if (!BINDING_RE.test(binding)) {
    throw new Error("artifact Buck cache-policy binding must be a canonical SHA-256 digest");
  }
}

function assertBaseIsolation(isolation: string): void {
  if (!isolation || !ISOLATION_RE.test(isolation)) {
    throw new Error("artifact Buck isolation must use a bounded canonical name");
  }
}

export function artifactBuckIsolation(baseIsolation: string, binding: string): string {
  assertBaseIsolation(baseIsolation);
  assertBinding(binding);
  return `${baseIsolation}${SUFFIX}${binding.slice(0, 24)}`;
}

export function artifactBuckAuthorityBinding(opts: {
  cachePolicyBinding: string;
  graphBytes: Buffer;
  artifactToolsRoot: string;
}): string {
  return createHash("sha256")
    .update("artifact-buck-authority-v1\0")
    .update(opts.cachePolicyBinding)
    .update("\0")
    .update(opts.graphBytes)
    .update("\0")
    .update(opts.artifactToolsRoot)
    .digest("hex");
}

function validPriorState(value: unknown, baseIsolation: string): value is IsolationState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<IsolationState>;
  return (
    typeof state.binding === "string" &&
    BINDING_RE.test(state.binding) &&
    typeof state.isolation === "string" &&
    state.isolation === artifactBuckIsolation(baseIsolation, state.binding)
  );
}

export async function reconcileArtifactBuckIsolation(opts: {
  root: string;
  baseIsolation: string;
  binding: string;
  killIsolation: (root: string, isolation: string) => Promise<void>;
}): Promise<{ isolation: string; killed: string[] }> {
  const isolation = artifactBuckIsolation(opts.baseIsolation, opts.binding);
  // Keep the binding index outside buck-out/tmp: verify housekeeping may purge tmp
  // while the intentionally reusable Buck daemon remains alive.
  const stateDir = path.join(opts.root, "buck-out", "artifact-cache-isolations");
  const stateFile = path.join(stateDir, `${opts.baseIsolation}.json`);
  const prior = await fsp
    .readFile(stateFile, "utf8")
    .then((raw) => JSON.parse(raw) as unknown)
    .catch(() => null);
  const killed: string[] = [];
  if (
    validPriorState(prior, opts.baseIsolation) &&
    (prior.binding !== opts.binding || prior.isolation !== isolation)
  ) {
    await opts.killIsolation(opts.root, prior.isolation);
    killed.push(prior.isolation);
  }
  await fsp.mkdir(stateDir, { recursive: true });
  const temp = `${stateFile}.${process.pid}.tmp`;
  await fsp.writeFile(temp, JSON.stringify({ binding: opts.binding, isolation }), {
    mode: 0o600,
  });
  await fsp.rename(temp, stateFile);
  return { isolation, killed };
}
