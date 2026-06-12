# 2. Supabase Project Provisioning

**Tier:** Foundation
**Priority:** 2 of 44
**Depends on:** none
**Estimated effort:** S
**Date:** 2026-05-25
**Summary:** Create and configure the Supabase project(s) that serve as the external Postgres database and optional auth backend for the deployment control plane, and register all connection credentials in Infisical.

## What

Provision the Supabase project(s) required by the control plane and register their credentials before any containerized or cloud-hosted control plane work begins.

Concrete steps:

- Create Supabase projects for dev, staging, and prod (or a single shared project with per-environment databases — see Trade-offs).
- Record the Postgres connection strings, pooler URLs, and database passwords.
- Register each credential in Infisical using the canonical `secret://deployments/control-plane/<env>/<credential-name>` SprinkleRef path so the control plane credential contract can resolve them without ambient environment variables.
- Run the initial schema migration against each database to verify connectivity and confirm the Postgres user has DDL rights.
- Test Supabase Storage against the `ControlPlaneArtifactStore` interface (PUT, GET, HEAD by immutable key, SHA-256 verify) to determine whether it can serve as the S3-compatible artifact store. Document the result; if it passes, register the Storage endpoint and credentials in Infisical alongside the database credentials.
- Document the provisioning steps in a runbook so the process is reproducible.

## Why Now

Task #6 (Containerize Control Plane + Move to Cloud) Phase 1 requires external Postgres as the first step of the cloud migration. Without a provisioned Supabase project and a registered connection string, Phase 1 cannot begin. Task #6 (Supabase/WorkOS Auth Provider) may also depend on Supabase Auth being available from an existing project. Task #23 (Supabase DB Deployment) wires Buck migrations against a project that must already exist. All three are blocked until this provisioning is complete.

Running the artifact store compatibility test here also eliminates the risk flagged in task #6: if Supabase Storage is incompatible with the `ControlPlaneArtifactStore` interface, the cloud migration can switch to R2 or S3 before implementation begins rather than after.

## Risks

- **Supabase Storage compatibility is unvalidated.** If Supabase Storage fails the `ControlPlaneArtifactStore` interface test, the artifact store backend must switch to Cloudflare R2 or AWS S3. R2 and S3 require separate account provisioning and credential registration. Discovering this failure mid-task delays the cloud migration.
- **Connection string rotation.** Supabase rotates pooler credentials when the database password changes. The Infisical-registered credentials must be updated in sync, or the control plane will fail to connect after a rotation. Establish a rotation procedure before the first deployment goes live.
- **Free-tier project limits.** Supabase's free tier pauses inactive projects after a period of inactivity. Use a paid plan or configure activity pings before the dev project hosts a real control plane.

## Trade-offs

- **One project per environment vs. shared project with per-environment databases.** Separate projects provide stronger isolation (separate Postgres instances, separate storage buckets, separate API keys) but multiply the number of credentials to manage. A shared project with per-environment schemas is simpler operationally but means a misconfigured migration could affect a sibling environment. Given that dev, staging, and prod have meaningfully different protection classes, separate projects are the safer default.
- **Supabase Postgres vs. standalone managed Postgres.** Supabase Postgres is convenient if Supabase Auth and Supabase Storage are also adopted, since credentials and billing are consolidated. A standalone managed Postgres (Neon, AWS RDS, Fly Postgres) is equally compatible with the `ControlPlaneArtifactStore` interface and may offer better performance or pricing at scale. The choice here is not irreversible, but switching later requires credential re-registration and a database migration.

## Considerations

- The connection string format exposed by Supabase Postgres uses the Supabase pooler by default. The control plane's Postgres client must be configured to use the direct connection string (not the pooler) for schema migrations, since the pooler does not support all DDL operations in transaction mode.
- If Supabase Auth is selected in task #8 (Supabase/WorkOS Auth Provider), the Supabase project provisioned here is also the auth project. Confirm that the project's auth settings (JWT secret, allowed redirect URLs) are configured at provisioning time, not left to task #8.
- The Infisical SprinkleRef paths registered here become the canonical credential contract for all downstream tasks. Establish the naming convention (`secret://deployments/control-plane/<env>/...`) before registering, so no paths need to be renamed later.
