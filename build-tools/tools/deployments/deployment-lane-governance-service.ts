#!/usr/bin/env zx-wrapper
import {
  normalizeLaneGovernanceSnapshot,
  verifyLaneGovernanceSnapshot,
} from "./deployment-admission-governance.ts";
import { fetchGithubLaneGovernanceSnapshot } from "./deployment-lane-governance-github.ts";
import type { DeploymentLaneGovernanceResolver } from "./deployment-lane-governance-resolution.ts";

const GITHUB_FIXTURE_ENV = "BNX_DEPLOY_GITHUB_GOVERNANCE_FIXTURE_JSON";

function fixtureSnapshotFor(repository: string, env: NodeJS.ProcessEnv | undefined) {
  const raw = String((env || process.env)[GITHUB_FIXTURE_ENV] || "").trim();
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return normalizeLaneGovernanceSnapshot(
    "branchProtections" in parsed ? parsed : (parsed[repository] as unknown),
  );
}

export function createServiceOwnedLaneGovernanceResolver(
  opts: {
    env?: NodeJS.ProcessEnv;
    localFixture?: boolean;
  } = {},
): DeploymentLaneGovernanceResolver {
  return async ({ deployment }) => {
    const governance = deployment.lanePolicy.governance;
    if (governance.scmBackend !== "github") {
      throw new Error(
        `automatic service-owned governance verification is unsupported for scm backend ${governance.scmBackend}; use explicit laneGovernance evidence only for this compatibility path`,
      );
    }
    const fixture = fixtureSnapshotFor(governance.repository, opts.env);
    if (fixture) {
      return verifyLaneGovernanceSnapshot({
        lanePolicy: deployment.lanePolicy,
        snapshot: fixture,
        verificationSource: "service_verified",
      });
    }
    if (opts.localFixture) {
      throw new Error(
        `set ${GITHUB_FIXTURE_ENV} for local fixture services so lane governance can be verified without live GitHub access`,
      );
    }
    return verifyLaneGovernanceSnapshot({
      lanePolicy: deployment.lanePolicy,
      snapshot: await fetchGithubLaneGovernanceSnapshot({
        lanePolicy: deployment.lanePolicy,
        env: opts.env,
      }),
      verificationSource: "service_verified",
    });
  };
}
