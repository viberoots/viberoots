# SaaS OCI Profile

This profile is valid only for selected platforms that preserve the control-plane runtime boundary:

- deploy an immutable image reference by digest
- mount config and credential files without exposing secret values as environment variables
- provide persistent writable scratch mounts for records, artifact staging, and runtime state
- deliver HTTPS ingress to the service container and outbound access to Git, Infisical, Postgres,
  object storage, and deployment provider APIs
- send graceful shutdown signals to service and worker containers before forced termination

Unsupported platforms are those that only support secret environment variables, tag-only images,
ephemeral-only filesystems, no outbound network, or no graceful shutdown contract.

Selected SaaS OCI platforms:

- Render Docker services are valid with runtime secret files, persistent disks, digest-pinned images,
  and separate service/worker components.
- Northflank services or jobs are valid with uploaded secret files, persistent volumes,
  digest-pinned images, and conformance-proven runtime-user access.
- Google Cloud Run services are conditionally valid with Secret Manager volume mounts and NFS or
  Cloud Storage FUSE volumes for persistent scratch state.

Fly.io Machines, Railway, and env-var-only app hosts are unsupported for this profile until a future
review proves file-backed credentials and persistent scratch ownership without secret env vars.

Run `zx-wrapper substrate-conformance.ts` from inside the candidate runtime before trusting the
substrate. The default checks validate cgroup visibility, active seccomp, DNS, credential-file
permissions, writable scratch mounts, scratch owner uid/gid, unsafe filesystem permission bits, and
optional clock skew against an operator-provided reference time. Run the same tool with
`--signal-marker <path>` as a canary command, stop the task, and confirm the marker records
`SIGTERM` or `SIGINT` before the platform's forced-stop deadline.
