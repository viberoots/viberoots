#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes";
import { extractKubernetesDeployments, extractVercelDeployments } from "../../deployments/contract";
import { DEPLOYMENT_GOLDENS } from "./deployment-goldens";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

const CQUERY_ATTRS =
  "name,rule_type,buck.type,provider,component,component_kind,publisher,publisher_config,provisioner,provisioner_config,protection_class,lane_policy,environment_stage,admission_policy,provider_target,components,prerequisites,secret_requirements,runtime_config_requirements,governance_policy,defaults,default_client_profile,scm_backend,repository,branch_protections,stages,stage_branches,allowed_promotion_edges,promotion_compatibility,allowed_refs,required_checks,required_approvals,retry_branch_policy,retry_approval_reuse,artifact_attestation_mode,labels".split(
    ",",
  );

async function read(root: string, rel: string): Promise<string> {
  return fsp.readFile(path.join(root, rel), "utf8");
}

async function scaffoldAll($: any, tmp: string): Promise<void> {
  await $`scaf new deployment shared demo --repository=example/platform --yes`;
  await $`scaf new deployment vercel-next demo-vercel --component=//projects/apps/console:vercel_artifact --team=acme --project=console --shared_package=demo-shared --yes`;
  await $`scaf new deployment service demo-api --component=//projects/apps/api:service_artifact --cluster=dev-cluster --shared_package=demo-shared --yes`;
  await $`scaf new deployment opentofu-foundation demo-foundation --component=//projects/apps/foundation:service_artifact --cluster=dev-cluster --shared_package=demo-shared --yes`;
  await $`scaf new deployment opentofu-provisioner demo-attached --yes`;
  await fsp.writeFile(
    path.join(tmp, "projects/deployments/TARGETS"),
    'load("//build-tools/deployments:defs.bzl", "deployment_defaults")\ndeployment_defaults(name = "defaults", visibility = ["PUBLIC"])\n',
  );
}

async function actualFiles(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(dir: string, prefix = ""): Promise<void> {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const rel = path.posix.join(prefix, entry.name);
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs, rel);
      else if (entry.name !== ".copier-answers.yml") out[rel] = await fsp.readFile(abs, "utf8");
    }
  }
  await walk(root);
  return out;
}

async function assertGoldenPackage(tmp: string, deploymentId: string): Promise<void> {
  const root = path.join(tmp, "projects/deployments", deploymentId);
  assert.deepEqual(await actualFiles(root), DEPLOYMENT_GOLDENS[deploymentId]);
}

test("deployment scaffolds render exact golden outputs for every template", async () => {
  await runInTemp("deployment-scaffold-goldens", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await scaffoldAll($, tmp);

    await assertGoldenPackage(tmp, "demo-shared");
    await assertGoldenPackage(tmp, "demo-vercel");
    await assertGoldenPackage(tmp, "demo-api");
    await assertGoldenPackage(tmp, "demo-foundation");
    await assertGoldenPackage(tmp, "demo-attached");

    await assert.rejects(read(tmp, "projects/deployments/demo-attached/TARGETS"));
  });
});

test("deployment scaffolds fail closed when required provider answers are missing", async () => {
  await runInTemp("deployment-scaffold-required", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    const cases = [
      {
        args: ["deployment", "shared", "missing", "--yes"],
        expected: /--repository/,
      },
      {
        args: ["deployment", "vercel-next", "missing", "--component=//x:y", "--yes"],
        expected: /--team, --project/,
      },
      {
        args: ["deployment", "service", "missing", "--cluster=dev-cluster", "--yes"],
        expected: /--component/,
      },
      {
        args: ["deployment", "service", "missing", "--component=//x:y", "--yes"],
        expected: /--cluster/,
      },
      {
        args: ["deployment", "opentofu-foundation", "missing", "--cluster=dev-cluster", "--yes"],
        expected: /--component/,
      },
      {
        args: ["deployment", "opentofu-foundation", "missing", "--component=//x:y", "--yes"],
        expected: /--cluster/,
      },
    ];
    for (const c of cases) {
      const result = await $`scaf new ${c.args}`.nothrow();
      assert.notEqual((result as any).exitCode, 0);
      assert.match(String((result as any).stderr || ""), c.expected);
    }
  });
});

test("generated deployment packages are Buck-queryable with fixture components", async () => {
  await runInTemp("deployment-scaffold-cquery", async (tmp, _$) => {
    const $ = _$({ cwd: tmp, stdio: "pipe" });
    await scaffoldAll($, tmp);
    await fsp.mkdir(path.join(tmp, "projects/apps/console"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "projects/apps/api"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "projects/apps/foundation"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "projects/apps/console/artifact.txt"), "artifact\n");
    await fsp.writeFile(path.join(tmp, "projects/apps/api/artifact.txt"), "artifact\n");
    await fsp.writeFile(path.join(tmp, "projects/apps/foundation/artifact.txt"), "artifact\n");
    await fsp.writeFile(
      path.join(tmp, "projects/apps/console/TARGETS"),
      'load("@prelude//:rules.bzl", "genrule")\ngenrule(name = "vercel_artifact", out = "artifact.txt", cmd = "echo console > $OUT", labels = ["kind:app", "webapp:ssr"], visibility = ["PUBLIC"])\n',
    );
    await fsp.writeFile(
      path.join(tmp, "projects/apps/api/TARGETS"),
      'load("@prelude//:rules.bzl", "genrule")\ngenrule(name = "service_artifact", out = "artifact.txt", cmd = "echo api > $OUT", labels = ["kind:app", "deployment-component:service"], visibility = ["PUBLIC"])\n',
    );
    await fsp.writeFile(
      path.join(tmp, "projects/apps/foundation/TARGETS"),
      'load("@prelude//:rules.bzl", "genrule")\ngenrule(name = "service_artifact", out = "artifact.txt", cmd = "echo foundation > $OUT", labels = ["kind:app", "deployment-component:service"], visibility = ["PUBLIC"])\n',
    );

    const attrFlags = CQUERY_ATTRS.flatMap((attr) => ["--output-attribute", attr]);
    const query =
      "set(//projects/deployments/demo-vercel:deploy //projects/deployments/demo-api:deploy //projects/deployments/demo-foundation:deploy //projects/apps/console:vercel_artifact //projects/apps/api:service_artifact //projects/apps/foundation:service_artifact //projects/deployments:defaults //projects/deployments/demo-shared:lane_governance //projects/deployments/demo-shared:lane //projects/deployments/demo-shared:dev_release)";
    const cquery = await $({
      env: { ...process.env, HOME: process.env.BUCK2_REAL_HOME || process.env.HOME },
    })`buck2 --isolation-dir ${inheritedBuckIsolation("deployment-scaffold")} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`;
    const nodes = nodesFromCqueryJson(JSON.parse(String(cquery.stdout || "{}")));
    const vercel = extractVercelDeployments(nodes);
    const kubernetes = extractKubernetesDeployments(nodes);
    assert.deepEqual(vercel.errors, []);
    assert.deepEqual(kubernetes.errors, []);
    assert.equal(vercel.deployments[0]?.providerTarget.project, "console");
    assert.deepEqual(kubernetes.deployments.map((deployment) => deployment.deploymentId).sort(), [
      "demo-api",
      "demo-foundation",
    ]);
    const foundation = kubernetes.deployments.find(
      (entry) => entry.deploymentId === "demo-foundation",
    );
    assert.equal(foundation?.providerTarget.cluster, "dev-cluster");
    assert.equal(foundation?.provisioner?.type, "opentofu-stack");
    assert.equal(foundation?.provisioner?.stackIdentity, "foundation/demo-foundation");
  });
});
