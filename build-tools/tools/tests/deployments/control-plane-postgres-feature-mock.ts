#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import type { BackendQueryable } from "../../deployments/nixos-shared-host-control-plane-backend-db";

export function managedPostgresFeatureMock(): {
  client: BackendQueryable;
  queries: string[];
} {
  const queries: string[] = [];
  let inTransaction = false;
  let tempTableExists = false;
  return {
    queries,
    client: {
      query: async <T extends Record<string, unknown> = Record<string, unknown>>(sql: string) => {
        queries.push(sql);
        if (sql === "BEGIN") {
          inTransaction = true;
          return { rows: [] as T[] };
        }
        if (sql === "COMMIT" || sql === "ROLLBACK") {
          inTransaction = false;
          tempTableExists = false;
          return { rows: [] as T[] };
        }
        if (sql === "SHOW server_version_num") {
          return { rows: [{ server_version_num: "160000" } as T] };
        }
        if (sql.includes("CREATE TEMP TABLE")) {
          assert.equal(inTransaction, true);
          tempTableExists = true;
          return { rows: [] as T[] };
        }
        if (sql.includes("vbr_control_plane_conformance_claims")) {
          assert.equal(tempTableExists, true);
        }
        return { rows: [] as T[] };
      },
    },
  };
}
