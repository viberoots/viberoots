#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { RuntimeGraph } from "../../deployments/resource-graph-runtime-graph";

test("runtime deploy runs link admitted policy resource refs to intent policy nodes", () => {
  const graph = new RuntimeGraph(
    {
      deploymentUidById: new Map([["demoapp-dev", "uid:deployment"]]),
      providerTargetUidById: new Map(),
      provisionerUidByDeploymentId: new Map(),
      policyByResourceId: new Map([
        ["//demo:admission", { uid: "uid:admission-policy", version: "sha256:admission" }],
      ]),
    },
    [],
  );
  graph.deployRun({
    deploy_run_id: "run-1",
    submission_id: "sub-1",
    record_path: "records/run-1.json",
    document_json: {
      deploymentId: "demoapp-dev",
      admittedContext: {
        policyEvaluation: {
          policyResourceRefs: [
            {
              kind: "AdmissionPolicy",
              resourceId: "//demo:admission",
              version: "sha256:admission",
            },
          ],
        },
      },
    },
  });
  assert.equal(
    graph.edges.some(
      (edge) =>
        edge.fromKind === "DeployRun" &&
        edge.toKind === "AdmissionPolicy" &&
        edge.toUid === "uid:admission-policy" &&
        edge.kind === "policy",
    ),
    true,
  );
});

test("runtime policy refs fail closed when intent policy version is stale", () => {
  const graph = new RuntimeGraph(
    {
      deploymentUidById: new Map([["demoapp-dev", "uid:deployment"]]),
      providerTargetUidById: new Map(),
      provisionerUidByDeploymentId: new Map(),
      policyByResourceId: new Map([
        [
          "provider-capability:cloudflare-pages",
          { uid: "uid:provider-policy", version: "current" },
        ],
      ]),
    },
    [],
  );
  assert.throws(
    () =>
      graph.deployRun({
        deploy_run_id: "run-1",
        submission_id: "sub-1",
        record_path: "records/run-1.json",
        document_json: {
          deploymentId: "demoapp-dev",
          admittedContext: {
            policyEvaluation: {
              policyResourceRefs: [
                {
                  kind: "ProviderCapabilityPolicy",
                  resourceId: "provider-capability:cloudflare-pages",
                  version: "stale",
                },
              ],
            },
          },
        },
      }),
    /runtime policy ref version mismatch/,
  );
});
