#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { CONTROL_PLANE_WEB_UI_JS } from "../../deployments/deployment-control-plane-web-ui";
import { queryBackend } from "../../deployments/nixos-shared-host-control-plane-backend-db";
import {
  localHarnessControlPlaneDatabaseUrl,
  writeBackendSubmissionDoc,
} from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { memoryControlPlaneArtifactStore } from "./control-plane-artifact-store-test-helpers";
import { runInTemp } from "../lib/test-helpers";

const TOKEN = "control-plane-web-token";

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

test("same-origin read APIs require auth and durable web sessions work across replicas", async () => {
  await runInTemp("control-plane-web-session", async (tmp) => {
    const backend = backendFor(tmp);
    const objectStore = memoryControlPlaneArtifactStore();
    const serviceA = await serviceFor(tmp, backend, objectStore);
    const serviceB = await serviceFor(tmp, backend, objectStore);
    try {
      const unauthorized = await fetch(new URL("/ops/api/v1/read/status", serviceA.url));
      assert.equal(unauthorized.status, 401);
      assert.equal((await fetch(new URL("/ops/api/v1/read/queue", serviceA.url))).status, 401);
      assert.equal(
        (await fetch(new URL("/ops/api/v1/read/deployments/demo-web", serviceA.url))).status,
        401,
      );
      const session = await readJson<any>(
        await fetch(new URL("/ops/api/v1/web/session", serviceA.url), {
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}` },
        }),
      );
      assert.equal(session.grants.read, true);
      assert.equal(session.grants.mutations, false);
      assert.equal(session.csrfToken, undefined);
      const status = await readJson<any>(
        await fetch(new URL("/ops/api/v1/read/status", serviceB.url), {
          headers: { "x-vbr-control-plane-session": session.sessionId },
        }),
      );
      const authContext = await readJson<any>(
        await fetch(new URL("/ops/api/v1/read/auth-context", serviceB.url), {
          headers: { "x-vbr-control-plane-session": session.sessionId },
        }),
      );
      assert.equal(status.database.ok, true);
      assert.equal(status.artifactStore.ok, true);
      assert.deepEqual(authContext, {
        principal: { kind: "service_token", principalId: "reviewed-service-token" },
        grants: { read: true, mutations: false, deployments: "authorized_scope" },
      });
      assert.equal(authContext.sessionId, undefined);
      assert.equal(authContext.csrfToken, undefined);
      assert.doesNotMatch(JSON.stringify(status), /control-plane-web-token|secret/i);
    } finally {
      await serviceA.close();
      await serviceB.close();
    }
  });
});

test("queue and deployment read models redact secret-looking durable state", async () => {
  await runInTemp("control-plane-web-redaction", async (tmp) => {
    const backend = backendFor(tmp);
    await seedSecretBearingState(backend, tmp);
    const service = await serviceFor(tmp, backend, memoryControlPlaneArtifactStore());
    try {
      const headers = { authorization: `Bearer ${TOKEN}` };
      const queue = await readJson<any>(
        await fetch(new URL("/ops/api/v1/read/queue", service.url), { headers }),
      );
      const detail = await readJson<any>(
        await fetch(new URL("/ops/api/v1/read/deployments/demo-web", service.url), { headers }),
      );
      const compatibilityRecord = await readJson<any>(
        await fetch(new URL("/api/v1/records?deployRunId=run-web", service.url), { headers }),
      );
      const rendered = JSON.stringify({ queue, detail, compatibilityRecord });
      assert.match(rendered, /<redacted>/);
      assert.doesNotMatch(
        rendered,
        /super-secret|hunter2|Bearer leaked|client-secret-value|env-dump-secret|artifact-secret/,
      );
      assert.equal(queue.submissions[0].deploymentId, "demo-web");
      assert.equal(detail.latestRun.deployRunId, "run-web");
      assert.equal(detail.latestRun.record, undefined);
    } finally {
      await service.close();
    }
  });
});

test("base-path web UI loads read-only screens and assets without mutation controls", async () => {
  await runInTemp("control-plane-web-base-path", async (tmp) => {
    const backend = backendFor(tmp);
    await seedSecretBearingState(backend, tmp);
    const service = await serviceFor(tmp, backend, memoryControlPlaneArtifactStore(), "/ops");
    try {
      const html = await (await fetch(new URL("/ops/queue", service.url))).text();
      const js = await (await fetch(new URL("/ops/assets/control-plane.js", service.url))).text();
      assert.match(html, /Deployment Control Plane/);
      assert.match(html, /\/ops\/assets\/control-plane\.js/);
      assert.doesNotMatch(`${html}\n${js}`, /<form|<button|run-actions|submissions/i);
      assert.match(js, /\/api\/v1\/read\/queue/);
      const session = await readJson<any>(
        await fetch(new URL("/ops/api/v1/web/session", service.url), {
          method: "POST",
          headers: { authorization: `Bearer ${TOKEN}` },
        }),
      );
      for (const route of ["/ops/", "/ops/queue", "/ops/deployment?deploymentId=demo-web"]) {
        const screen = await renderUiRoute(service.url, route, session.sessionId);
        assert.match(screen, /Status|Queue|Deployment/);
        assert.doesNotMatch(screen, /artifact-secret|env-dump-secret|run-actions/i);
      }
    } finally {
      await service.close();
    }
  });
});

test("root base-path web UI uses root asset and API paths", async () => {
  await runInTemp("control-plane-web-root-base-path", async (tmp) => {
    const backend = backendFor(tmp);
    const service = await serviceFor(tmp, backend, memoryControlPlaneArtifactStore(), "/");
    try {
      const html = await (await fetch(new URL("/", service.url))).text();
      const js = await (await fetch(new URL("/assets/control-plane.js", service.url))).text();
      assert.match(html, /src="\/assets\/control-plane\.js"/);
      assert.match(js, /base \+ path/);
      assert.equal((await fetch(new URL("/api/v1/read/status", service.url))).status, 401);
    } finally {
      await service.close();
    }
  });
});

function backendFor(tmp: string) {
  const recordsRoot = path.join(tmp, "records");
  return { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
}

async function serviceFor(
  tmp: string,
  backend: { recordsRoot: string; databaseUrl: string },
  objectStore: ReturnType<typeof memoryControlPlaneArtifactStore>,
  basePath = "/ops",
) {
  return await startNixosSharedHostControlPlaneServer({
    workspaceRoot: tmp,
    paths: {
      statePath: path.join(tmp, "state.json"),
      hostRoot: tmp,
      recordsRoot: backend.recordsRoot,
    },
    backendDatabaseUrl: backend.databaseUrl,
    token: TOKEN,
    objectStore,
    webUi: { enabled: true, basePath },
  });
}

async function renderUiRoute(
  serviceUrl: string,
  route: string,
  sessionId: string,
): Promise<string> {
  const app = { innerHTML: "Loading..." };
  const context = vm.createContext({
    window: {
      __CONTROL_PLANE_BASE_PATH__: "/ops",
      localStorage: { getItem: () => sessionId },
    },
    location: {
      pathname: route.split("?")[0],
      search: route.includes("?") ? `?${route.split("?")[1]}` : "",
    },
    document: { getElementById: () => app },
    URLSearchParams,
    fetch: async (input: string, init?: RequestInit) =>
      await fetch(new URL(input, serviceUrl), init),
  });
  vm.runInContext(CONTROL_PLANE_WEB_UI_JS, context);
  for (let i = 0; i < 20 && app.innerHTML === "Loading..."; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return app.innerHTML;
}

async function seedSecretBearingState(
  backend: { recordsRoot: string; databaseUrl: string },
  tmp: string,
) {
  await writeBackendSubmissionDoc(
    backend,
    {
      submissionId: "submit-web",
      submittedAt: "2026-05-15T12:00:00.000Z",
      deploymentId: "demo-web",
      deploymentLabel: "//demo:web",
      operationKind: "deploy",
      lockScope: "demo-web",
      executionSnapshotPath: path.join(tmp, "snapshot.json"),
      lifecycleState: "finished",
      providerError: "Authorization: Bearer leaked",
      infisicalClientSecret: "client-secret-value",
    } as any,
    {
      submissionPath: path.join(tmp, "submission.json"),
      executionSnapshotPath: path.join(tmp, "snapshot.json"),
    },
  );
  await queryBackend(
    backend,
    `INSERT INTO deploy_records(deploy_run_id, submission_id, record_path, document_json, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [
      "run-web",
      "submit-web",
      path.join(tmp, "record.json"),
      JSON.stringify({
        deployRunId: "run-web",
        deploymentId: "demo-web",
        finalOutcome: "publish_failed",
        error: "password=hunter2 token=super-secret",
        rawEnv: { VBR_TOKEN: "env-dump-secret", PATH: "/bin" },
        controlPlane: { submissionId: "submit-web" },
        artifact: {
          identity: "static-webapp:demo",
          metadata: { authorization: "Bearer artifact-secret" },
          contents: "<html>artifact-secret</html>",
        },
        artifactContents: "artifact-secret payload",
      }),
      "2026-05-15T12:01:00.000Z",
    ],
  );
}
