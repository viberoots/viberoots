import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  artifactNixIndependentPolicyArgs,
  REVIEWED_REQUIRED_SUBSTITUTERS,
} from "../../lib/artifact-nix-policy";
import { activateNixCachePolicyCapabilityAfterCanonicalEntry } from "../../lib/nix-cache-policy-capability";
import { renderReviewedNixCacheConfig } from "../../dev/verify/nix-cache-health-config";
import {
  protectedRustPatchCaseIds,
  runProtectedRustPatchCaseDrivers,
} from "../../ci/protected-rust-patch-case-driver";

const NON_AUTHORITATIVE_LOCAL_DAEMON = true;
const SHARD_COUNT = 10;
const DARWIN_TAURI_CASE_ID = "rust-tauri-darwin-pr12";
const LOCAL_DAEMON_EXCLUDED_CASE_IDS = new Set([DARWIN_TAURI_CASE_ID]);

export function registerProtectedRustPatchLocalDaemonIntegration(shardIndex: number): void {
  if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= SHARD_COUNT) {
    throw new Error(`invalid protected Rust patch local-daemon shard: ${shardIndex}`);
  }
  test(
    `local-daemon patch driver integration shard ${shardIndex + 1}/${SHARD_COUNT} is explicitly non-authoritative`,
    { timeout: 2_700_000 },
    async () => {
      const nixCachePolicyCapability = activateNixCachePolicyCapabilityAfterCanonicalEntry(
        { VBR_CANONICAL_ARTIFACT_ENTRYPOINT: "1" },
        {
          kind: "reviewed",
          config: renderReviewedNixCacheConfig("", [...REVIEWED_REQUIRED_SUBSTITUTERS], []),
          policy: "auto",
          requiredSubstituters: REVIEWED_REQUIRED_SUBSTITUTERS,
          optionalSubstituters: [],
        },
      );
      const root = path.resolve(import.meta.dirname, "../../../..");
      const nix = async (args: string[]) => {
        const result = await $({
          cwd: root,
          env: { ...process.env, NIX_REMOTE: "daemon" },
          stdio: "pipe",
        })`${[
          "nix",
          ...artifactNixIndependentPolicyArgs("reviewed"),
          "--option",
          "eval-cache",
          "false",
          ...args,
        ]}`;
        return { stdout: String(result.stdout), stderr: String(result.stderr) };
      };
      const runWithRemoteStore = async (opts: {
        command: string;
        args?: string[];
        cwd?: string;
        timeoutMs?: number;
      }) => {
        const result = await $({
          cwd: opts.cwd || root,
          env: { ...process.env, NIX_REMOTE: "daemon" },
          stdio: "pipe",
          timeout: opts.timeoutMs,
        })`${[opts.command, ...(opts.args || [])]}`;
        return { stdout: String(result.stdout), stderr: String(result.stderr) };
      };
      const tools = (
        await nix([
          "build",
          "--accept-flake-config",
          "--no-write-lock-file",
          "--no-link",
          "--print-out-paths",
          `path:${root}#remote-ci-tools`,
        ])
      ).stdout.trim();
      assert.match(tools, /^\/nix\/store\/[a-z0-9]{32}-remote-ci-tools$/u);
      const system = (
        await nix(["eval", "--impure", "--raw", "--expr", "builtins.currentSystem"])
      ).stdout.trim();
      const productionCaseIds = protectedRustPatchCaseIds(system);
      const allCaseIds = productionCaseIds.filter(
        (caseId) => !LOCAL_DAEMON_EXCLUDED_CASE_IDS.has(caseId),
      );
      const shards = Array.from({ length: SHARD_COUNT }, () => [] as string[]);
      for (const [index, caseId] of allCaseIds.entries()) {
        shards[index % SHARD_COUNT]!.push(caseId);
      }
      assert.deepEqual(
        shards.flat().toSorted(),
        allCaseIds.toSorted(),
        "protected Rust patch local-daemon shards must cover the exact local-daemon smoke matrix",
      );
      assert.ok(
        productionCaseIds.every(
          (caseId) => allCaseIds.includes(caseId) || LOCAL_DAEMON_EXCLUDED_CASE_IDS.has(caseId),
        ),
        "protected Rust patch local-daemon smoke exclusions must be explicit",
      );
      const caseIds = shards[shardIndex]!;
      assert.ok(
        caseIds.length > 0,
        `protected Rust patch local-daemon shard ${shardIndex + 1} is empty`,
      );
      const results = await runProtectedRustPatchCaseDrivers({
        active: { runNix: nix, runWithRemoteStore },
        remoteCiTools: tools,
        system,
        caseIds,
        nixCachePolicyCapability,
      });
      assert.equal(NON_AUTHORITATIVE_LOCAL_DAEMON, true);
      assert.deepEqual(
        results.map(({ caseId }) => caseId),
        caseIds,
      );
      assert.ok(
        results.every(({ driverSource }) => driverSource.startsWith(`${tools}${path.sep}`)),
      );
      process.stdout.write(
        `${JSON.stringify({ nonAuthoritative: true, shardIndex, shardCount: SHARD_COUNT, results })}\n`,
      );
    },
  );
}
