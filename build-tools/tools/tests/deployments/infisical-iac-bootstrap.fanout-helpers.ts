#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export async function graph(nodes: unknown[]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-fanout-"));
  return await graphIn(dir, nodes);
}

export async function graphIn(dir: string, nodes: unknown[]) {
  const graphPath = path.join(dir, "graph.json");
  await fs.writeFile(graphPath, `${JSON.stringify({ nodes }, null, 2)}\n`);
  return graphPath;
}

export function deploymentNode(name: string, family: string) {
  return {
    name,
    rule_type: "deployment_target",
    deployment_family: family,
    environment_stage: "prod",
    secret_backend: "infisical/default",
    infisical_runtime: { project_id: "proj_1", environment: "prod" },
  };
}

export function fanOutOnlyNode(name: string) {
  return sampleWebappContextNode(name, "sample-webapp-staging");
}

export function promptOnlyFanOutNode(name: string) {
  return {
    ...deploymentNode(name, "sample-webapp"),
    secret_backend: undefined,
  };
}

export function sampleWebappContextNode(name: string, deploymentContext: string) {
  const stage = deploymentContext.endsWith("prod") ? "prod" : "staging";
  return {
    name,
    rule_type: "deployment_target",
    deployment_family: "sample-webapp",
    environment_stage: stage,
    deployment_context: deploymentContext,
    infisical_runtime: {},
    secret_requirements: [
      {
        ref: `secret://deployments/sample-webapp/${stage}/cloudflare/api-token`,
        required: true,
      },
    ],
  };
}

export async function writeRepoOnlyResolver(dir: string) {
  await fs.mkdir(path.join(dir, "projects/config"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "projects/config/shared.json"),
    `${JSON.stringify(
      {
        schemaVersion: "viberoots-project-config@1",
        sprinkleref: {
          version: 1,
          defaultCategory: "main",
          categories: {
            main: { backend: "local-file", file: ".local/main.json" },
            bootstrap: { backend: "local-file", file: ".local/bootstrap.json" },
          },
        },
        controlPlanes: {
          "sample-webapp": {
            serviceClient: {
              controlPlaneUrl: "https://control.example",
              controlPlaneTokenRef: "runtime://github-actions/control-plane-token",
            },
          },
        },
        deploymentContexts: {
          "sample-webapp-staging": sampleWebappDeploymentContext("staging"),
          "sample-webapp-prod": sampleWebappDeploymentContext("prod"),
        },
      },
      null,
      2,
    )}\n`,
  );
}

function sampleWebappDeploymentContext(stage: "staging" | "prod") {
  return {
    controlPlane: "sample-webapp",
    secretBackend: "infisical/default",
    infisical: {
      host: "https://app.infisical.com",
      projectId: "proj_sample_webapp",
      projectName: "Sample webapp",
      projectSlug: "sample-webapp",
      environment: stage,
      defaultPath: `/deployments/sample-webapp/${stage}`,
    },
  };
}
