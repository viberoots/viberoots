#!/usr/bin/env zx-wrapper
import http from "node:http";

type FakeVaultVersion = {
  value: string;
  deleted?: boolean;
};

export type FakeVaultSecret = {
  currentVersion: string;
  versions: Record<string, FakeVaultVersion>;
};

export type FakeVaultState = Record<string, FakeVaultSecret>;

function contractIdFor(requestPath: string, prefix: string): string {
  return `secret://${requestPath.slice(prefix.length).replace(/^\/+/, "")}`;
}

function json(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function startFakeVaultServer(state: FakeVaultState, token = "test-token") {
  const server = http.createServer((request, response) => {
    if (request.headers["x-vault-token"] !== token) {
      json(response, 403, { errors: ["forbidden"] });
      return;
    }
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/v1/secret/metadata/")) {
      const secret = state[contractIdFor(url.pathname, "/v1/secret/metadata/")];
      if (!secret) {
        json(response, 404, { errors: ["missing"] });
        return;
      }
      json(response, 200, { data: { current_version: Number(secret.currentVersion) } });
      return;
    }
    if (url.pathname.startsWith("/v1/secret/data/")) {
      const contractId = contractIdFor(url.pathname, "/v1/secret/data/");
      const secret = state[contractId];
      if (!secret) {
        json(response, 404, { errors: ["missing"] });
        return;
      }
      const version = String(url.searchParams.get("version") || secret.currentVersion).trim();
      const selected = secret.versions[version];
      if (!selected || selected.deleted) {
        json(response, 404, { errors: ["missing_version"] });
        return;
      }
      json(response, 200, {
        data: {
          data: { value: selected.value },
          metadata: { version: Number(version) },
        },
      });
      return;
    }
    json(response, 404, { errors: ["unknown_path"] });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start fake Vault server");
  }
  return {
    token,
    addr: `http://127.0.0.1:${String(address.port)}`,
    close: async () => await new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
