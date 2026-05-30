# Control Plane Managed Dependencies

Managed dependency profiles let operators validate durable Postgres and S3-compatible artifact
storage before a cloud control-plane host uses them for protected/shared deploys.

Profiles are setup inputs, not browser-visible config. They reference credential files only:

```yaml
profileName: supabase-postgres-r2
compatibilityEvidenceFile: ./evidence/supabase-postgres-r2.json
runtimePath:
  expectedHostProfile: aws-ec2
  expectedAwsRegion: us-east-1
  databaseConnectivityMode: public
  expectedSupabaseProjectRef: projectref
  expectedSupabaseRegion: us-east-1
  expectedS3VpcEndpointId: vpce-123
postgres:
  provider: supabase-postgres
  urlFile: /run/deployment-control-plane/credentials/control-plane-database-url
artifactStore:
  provider: cloudflare-r2
  bucket: deploy-artifacts
  region: auto
  endpointFile: /run/deployment-control-plane/credentials/artifact-store-endpoint
  accessKeyIdFile: /run/deployment-control-plane/credentials/artifact-store-access-key-id
  secretAccessKeyFile: /run/deployment-control-plane/credentials/artifact-store-secret-access-key
  keyPrefix: tmp/control-plane-conformance
```

Supported providers are explicit candidate labels:

- Postgres: `supabase-postgres`, `postgres-compatible`
- Artifact store: `aws-s3`, `supabase-storage-s3`, `cloudflare-r2`, `s3-compatible`

Run validation with the same mounted credential directory the service or workers will use:

```bash
zx-wrapper build-tools/tools/deployments/control-plane-managed-dependencies.ts \
  --profile ./managed-dependencies.yaml \
  --credential-directory /run/deployment-control-plane/credentials \
  --host-profile aws-ec2 \
  --aws-region us-east-1 \
  --source-host-identity i-0abc1234 \
  --source-host-kind aws-ec2
```

The validator checks managed Postgres features used by the control plane, including JSONB, temporary
tables, `FOR UPDATE SKIP LOCKED`, `INSERT ON CONFLICT`, and `RETURNING`. It checks the object store
through the same S3-compatible artifact-store implementation workers use: `PUT`, `GET`, `HEAD`,
metadata, content type, digest verification, and signing region.

Evidence is written as JSON when `compatibilityEvidenceFile` is set. Evidence records provider
labels, observed runtime host profile, observed AWS region, selected database connectivity mode,
source host identity and kind, Supabase project and region labels when supplied, resolved database
host, TLS status, non-secret bucket/region/endpoint host, checked operations, digest, object key,
S3 VPC endpoint proof for AWS S3, and Postgres feature results. It must not contain database URLs,
access keys, secret keys, or credential file contents.

Expected runtime fields in `runtimePath`, including the selected database connectivity mode, are
compared against observed command inputs or connection facts. The validator does not copy expected
PrivateLink, Supabase, or S3 endpoint identities into evidence. For PrivateLink and AWS S3 cutover
evidence, pass the observed endpoint/resource facts with `--host-profile`, `--aws-region`,
`--source-host-identity`, `--source-host-kind`, `--supabase-project-ref`, `--supabase-region`,
`--privatelink-endpoint-id`, `--privatelink-resource-id`, `--s3-vpc-endpoint-id`, and
`--s3-endpoint-policy-digest` as applicable.

Database connectivity mode is explicit:

- `public` requires TLS-enabled Postgres evidence for the selected Supabase project.
- `privatelink` rejects public Supabase database hostnames and requires PrivateLink endpoint or
  resource identity. Cutover evidence must come from the AWS EC2 runtime path unless the profile is
  explicitly marked `nonCutoverDiagnostic: true`.

Supabase project, Supabase region, PrivateLink endpoint/resource, and S3 VPC endpoint expectations
may be explicit operator-reviewed profile inputs until the generated Supabase lifecycle profile
supplies the same fields.

Supabase-specific values:

- Supabase Postgres uses the project Postgres connection string in `control-plane-database-url`.
- Supabase Storage S3 uses provider `supabase-storage-s3`, the project Storage S3 endpoint, the
  reviewed bucket name, and the signing region required by Supabase for that endpoint.

Cloudflare R2 comparison values:

- R2 uses provider `cloudflare-r2`.
- The endpoint should be the account S3 endpoint.
- Most R2 profiles use signing region `auto`.

AWS S3 values:

- Use provider `aws-s3`.
- Include the selected bucket, AWS region, and either the S3 VPC endpoint id or endpoint policy
  digest in `runtimePath` so object conformance is tied to the reviewed AWS path.

Alternate artifact backend values:

- For AWS-hosted runtime paths using Supabase Storage S3, Cloudflare R2, or another reviewed
  S3-compatible backend, include and pass structured alternate-backend evidence reference and digest
  values with `expectedAlternateBackendEvidenceRef`, `expectedAlternateBackendEvidenceDigest`,
  `--alternate-backend-evidence-ref`, and `--alternate-backend-evidence-digest`.

Live tests are disabled by default and are selected per candidate:

- Supabase Postgres: set `VBR_SUPABASE_POSTGRES_LIVE_CONFORMANCE=1` and
  `VBR_SUPABASE_POSTGRES_LIVE_DATABASE_URL_FILE`.
- Supabase Storage S3: set `VBR_SUPABASE_STORAGE_S3_LIVE_CONFORMANCE=1` plus
  `VBR_SUPABASE_STORAGE_S3_LIVE_ENDPOINT_FILE`,
  `VBR_SUPABASE_STORAGE_S3_LIVE_ACCESS_KEY_ID_FILE`,
  `VBR_SUPABASE_STORAGE_S3_LIVE_SECRET_ACCESS_KEY_FILE`,
  `VBR_SUPABASE_STORAGE_S3_LIVE_BUCKET`, and `VBR_SUPABASE_STORAGE_S3_LIVE_REGION`.
- Cloudflare R2 comparison: set `VBR_CLOUDFLARE_R2_LIVE_CONFORMANCE=1` plus
  `VBR_CLOUDFLARE_R2_LIVE_ENDPOINT_FILE`, `VBR_CLOUDFLARE_R2_LIVE_ACCESS_KEY_ID_FILE`,
  `VBR_CLOUDFLARE_R2_LIVE_SECRET_ACCESS_KEY_FILE`, `VBR_CLOUDFLARE_R2_LIVE_BUCKET`, and
  `VBR_CLOUDFLARE_R2_LIVE_REGION`.

For Supabase Storage S3 and R2, optional `*_PREFIX` values keep temporary conformance objects under
a reviewed non-production prefix.
