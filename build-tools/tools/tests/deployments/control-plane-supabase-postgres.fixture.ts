#!/usr/bin/env zx-wrapper
import { reviewedSupabaseManagedPostgresProfile } from "../../deployments/control-plane-supabase-postgres-profile";

export function privateLinkSupabaseProfile() {
  return reviewedSupabaseManagedPostgresProfile({
    instanceId: "cloud-control-plane",
    region: "us-east-1",
    mode: "privatelink",
    organizationId: "org-control-plane-prod",
    projectRef: "project-review",
  });
}

export function publicSupabaseProfile() {
  return reviewedSupabaseManagedPostgresProfile({
    instanceId: "cloud-control-plane",
    region: "us-east-1",
    mode: "public",
    organizationId: "org-control-plane-prod",
    projectRef: "project-review",
  });
}
