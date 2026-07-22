import { REVIEWED_PUBLIC_KEYS, REVIEWED_SUBSTITUTERS } from "../lib/artifact-nix-policy";
import { parseRemoteBuilderEndpoint } from "./remote-builder-authority";

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: string[], name: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i]))
    throw new Error(`${name} has invalid fields`);
}

export function assertRemoteBuilderPolicyAssertionV3(
  value: unknown,
): asserts value is Record<string, unknown> {
  const assertion = record(value, "remote builder policy assertion");
  exact(
    assertion,
    ["builder", "effectivePolicy", "probeFlakeStorePath", "probes", "schema", "supportedSystem"],
    "policy assertion",
  );
  if (assertion.schema !== "viberoots.remote-builder-policy-assertion.v3")
    throw new Error("remote builder policy assertion requires v3");
  if (
    !["aarch64-darwin", "aarch64-linux", "x86_64-linux"].includes(String(assertion.supportedSystem))
  )
    throw new Error("remote builder policy assertion has unsupported system");
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(String(assertion.probeFlakeStorePath || ""))) {
    throw new Error("remote builder policy assertion lacks its immutable probe authority");
  }
  const builder = record(assertion.builder, "policy assertion builder");
  exact(builder, ["endpoint", "identity"], "policy assertion builder");
  if (!/^reviewed:[a-z0-9][a-z0-9._-]*$/u.test(String(builder.identity || "")))
    throw new Error("remote builder policy assertion has invalid identity");
  parseRemoteBuilderEndpoint(builder.endpoint);
  const policy = record(assertion.effectivePolicy, "policy assertion effective policy");
  exact(
    policy,
    [
      "hostPaths",
      "inspection",
      "multiUser",
      "publicKeys",
      "sandbox",
      "sandboxFallback",
      "substituters",
    ],
    "policy assertion effective policy",
  );
  if (
    policy.inspection !== "trusted-builder-daemon-with-live-canaries" ||
    policy.sandbox !== true ||
    policy.sandboxFallback !== false ||
    policy.multiUser !== "daemon"
  )
    throw new Error("remote builder policy assertion does not prove daemon sandbox policy");
  if (!Array.isArray(policy.hostPaths) || policy.hostPaths.length !== 0)
    throw new Error("remote builder policy assertion contains host paths");
  if (
    JSON.stringify(policy.substituters) !== JSON.stringify(REVIEWED_SUBSTITUTERS) ||
    JSON.stringify(policy.publicKeys) !== JSON.stringify(REVIEWED_PUBLIC_KEYS)
  )
    throw new Error("remote builder policy assertion contains unreviewed cache policy");
  const probes = record(assertion.probes, "policy assertion probes");
  const expected = {
    fixedOutputCorrectHash: "passed",
    fixedOutputWrongHash: "denied",
    ordinaryHostRead: "denied",
    ordinaryNetwork: "denied",
    store: "passed",
  };
  exact(probes, Object.keys(expected), "policy assertion probes");
  if (Object.entries(expected).some(([name, result]) => probes[name] !== result))
    throw new Error("remote builder policy assertion has invalid canary results");
}
