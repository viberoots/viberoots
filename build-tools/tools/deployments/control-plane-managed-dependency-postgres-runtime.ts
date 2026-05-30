#!/usr/bin/env zx-wrapper
import type { ControlPlaneManagedDependencyProfile } from "./control-plane-managed-dependency-types";

export type PostgresConnectionFacts = {
  resolvedHost: string;
  tlsEnabled: boolean;
  supabaseProjectRef?: string;
};

export function postgresConnectionFacts(databaseUrl: string): PostgresConnectionFacts {
  const parsed = new URL(databaseUrl);
  const sslMode = (parsed.searchParams.get("sslmode") || "").toLowerCase();
  const ssl = (parsed.searchParams.get("ssl") || "").toLowerCase();
  return {
    resolvedHost: parsed.hostname,
    tlsEnabled: ["require", "verify-ca", "verify-full"].includes(sslMode) || ssl === "true",
    supabaseProjectRef: supabaseProjectRef(parsed.hostname),
  };
}

export function assertPostgresMatchesRuntimePath(
  profile: ControlPlaneManagedDependencyProfile,
  facts: PostgresConnectionFacts,
): void {
  const runtime = profile.runtimePath;
  if (!facts.tlsEnabled) throw new Error("managed Postgres URL must require TLS");
  if (runtime.expectedSupabaseProjectRef) {
    if (!facts.supabaseProjectRef && runtime.databaseConnectivityMode === "public") {
      throw new Error("managed Postgres URL missing expected Supabase project ref proof");
    }
    if (
      facts.supabaseProjectRef &&
      runtime.expectedSupabaseProjectRef !== facts.supabaseProjectRef
    ) {
      throw new Error("managed Postgres URL does not match expected Supabase project ref");
    }
  }
  if (
    runtime.databaseConnectivityMode === "privatelink" &&
    isPublicSupabaseHost(facts.resolvedHost)
  ) {
    throw new Error("PrivateLink mode cannot use a public Supabase database hostname");
  }
}

function supabaseProjectRef(host: string): string | undefined {
  const match = /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(host);
  return match?.[1];
}

function isPublicSupabaseHost(host: string): boolean {
  return /\.supabase\.co$/i.test(host) || /\.pooler\.supabase\.com$/i.test(host);
}
