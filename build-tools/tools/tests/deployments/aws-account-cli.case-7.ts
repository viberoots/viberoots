import {
  NOW,
  assert,
  fakeSupabaseFetch,
  fsp,
  path,
  removeCanonicalStackConfig,
  runAwsAccountCommand,
  runInTemp,
  test,
  withControlPlaneArgv,
  withCwd,
} from "./aws-account-cli.helpers";

const TOKEN_REF = "secret://control-plane/supabase/management-api-token";

test("aws-account help describes local SprinkleRef first-run setup", async () => {
  const out: string[] = [];
  await withControlPlaneArgv(["aws-account", "--help"], () =>
    runAwsAccountCommand({ stdout: (text) => out.push(text) }),
  );
  const help = out.join("\n");
  assert.match(help, /normal first run:[\s\S]*control-plane aws-account config-init/);
  assert.match(help, /normal first run:[\s\S]*sprinkleref --init-local/);
  assert.match(help, /normal first run:[\s\S]*control-plane aws-account check/);
  assert.match(help, /required coordinates:.*awsOrganizationId/);
  assert.match(help, /structured refs:.*config:\/\/.*secret:\/\//);
  assert.match(help, /fill local non-secret coordinates.*local\/values\.json/);
  assert.match(help, /fill local non-secret coordinates.*selected\/default resolver/);
  assert.match(help, /sources:.*stack config.*local\/values\.json.*selected\/default resolver/);
  assert.match(
    help,
    /sprinkleref --update secret:\/\/control-plane\/supabase\/management-api-token --create-missing/,
  );
  assert.match(help, /token:.*write the Supabase Management API token with sprinkleref --update/);
  assert.match(help, /do not use token write commands for awsOrganizationId/);
  assert.doesNotMatch(help, /supabaseAccessTokenRef|supabase-access-token-ref/);
  assert.doesNotMatch(
    help,
    /aws-account bootstrap --domain <domain> --expected-aws-account-id <id>/,
  );
});

test("aws-account bootstrap token ref rejects Infisical-backed bootstrap category", async () => {
  await runInTemp("aws-account-bootstrap-infisical-token", async (tmp) => {
    await writeInfisicalBootstrapConfig(tmp);
    await writeStackConfig(tmp, { supabaseAccessToken: { ref: TOKEN_REF, category: "bootstrap" } });
    const status = await runBlockedCheck(tmp);
    const phase = status.phases["check-supabase"];
    assert.equal(phase.state, "blocked");
    assert.match(phase.message, /Supabase PrivateLink readiness is incomplete/);
    assert.match(phase.missingConfigFields[0]?.note || "", /do not put token values/);
    assert.match(phase.missingConfigFields[0]?.note || "", /SUPABASE_ACCESS_TOKEN/);
    const evidence = await readSupabaseEvidence(tmp);
    assert.match(evidence.errors.join("\n"), /bootstrap category must not use an Infisical/);
  });
});

test("aws-account local redirect to bootstrap applies the bootstrap guard", async () => {
  await runInTemp("aws-account-bootstrap-redirect-infisical", async (tmp) => {
    await writeInfisicalBootstrapConfig(tmp);
    await writeStackConfig(tmp, { supabaseAccessToken: { ref: TOKEN_REF } });
    await writeLocalValues(tmp, { ref: TOKEN_REF, category: "bootstrap" });
    const status = await runBlockedCheck(tmp);
    assert.equal(status.phases["check-supabase"].state, "blocked");
    const evidence = await readSupabaseEvidence(tmp);
    assert.equal(evidence.supabaseAccessToken.localValuesPath.endsWith("values.json"), true);
    assert.match(evidence.errors.join("\n"), /bootstrap category must not use an Infisical/);
  });
});

test("aws-account allows non-Infisical bootstrap token refs and records metadata", async () => {
  await runInTemp("aws-account-bootstrap-local-file-token", async (tmp) => {
    await writeLocalFileBootstrapConfig(tmp);
    await writeStackConfig(tmp, { supabaseAccessToken: { ref: TOKEN_REF, category: "bootstrap" } });
    await fsp.writeFile(
      path.join(tmp, ".local", "bootstrap.json"),
      `${JSON.stringify({ [TOKEN_REF]: "test-token" }, null, 2)}\n`,
    );
    const status = await runPassingCheck(tmp);
    assert.equal(status.phases["check-supabase"].state, "passed");
    const evidence = await readSupabaseEvidence(tmp);
    assert.equal(evidence.supabaseAccessToken.source, "sprinkleref");
    assert.equal(evidence.supabaseAccessToken.category, "bootstrap");
    assert.equal(evidence.supabaseAccessToken.categoryExplicit, true);
    assert.match(evidence.supabaseAccessToken.backend, /local-file/);
    assert.doesNotMatch(JSON.stringify(evidence), /test-token/);
  });
});

test("aws-account check blocks and guides missing AWS organization id", async () => {
  await runInTemp("aws-account-missing-org-guidance", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    const out: string[] = [];
    const status = await runCheckWithExitReset(tmp, out, [
      "aws-account",
      "check",
      "--domain",
      "example.com",
      "--evidence-dir",
      path.join(tmp, "evidence"),
      "--expected-aws-account-id",
      "123456789012",
      "--supabase-org-id",
      "supabase-org",
      "--supabase-project-ref",
      "project-ref",
    ]);
    assert.equal(status.phases["check-aws-login"].state, "blocked");
    assert.match(out[0] || "", /awsOrganizationId/);
    assert.match(out[0] || "", /Stack config:[\s\S]*"awsOrganizationId": "<aws-organization-id>"/);
    assert.doesNotMatch(out[0] || "", /secret:\/\/control-plane\/aws\/organization-id/);
    assert.doesNotMatch(out[0] || "", /SUPABASE_ACCESS_TOKEN.*awsOrganizationId/);
  });
});

async function runBlockedCheck(tmp: string) {
  return await runCheckWithExitReset(tmp, [], ["aws-account", "check", "--config", stackPath(tmp)]);
}

async function runPassingCheck(tmp: string) {
  const out: string[] = [];
  return await runCheckWithExitReset(tmp, out, [
    "aws-account",
    "check",
    "--config",
    stackPath(tmp),
  ]);
}

async function runCheckWithExitReset(tmp: string, out: string[], argv: string[]) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await withControlPlaneArgv(argv, () =>
      runAwsAccountCommand({
        cwd: tmp,
        now: () => NOW,
        env: {},
        httpFetch: fakeSupabaseFetch,
        stdout: (text) => out.push(text),
        toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
        commandRunner: async () => ({
          stdout: JSON.stringify({ Account: "123456789012" }),
          stderr: "",
        }),
      }),
    );
  } finally {
    process.exitCode = previousExitCode;
  }
  return JSON.parse(await fsp.readFile(path.join(tmp, "evidence", "status.json"), "utf8"));
}

async function writeStackConfig(tmp: string, extra: Record<string, unknown> = {}) {
  await fsp.mkdir(path.dirname(stackPath(tmp)), { recursive: true });
  await fsp.writeFile(
    stackPath(tmp),
    `${JSON.stringify(
      {
        domain: "example.com",
        evidenceDir: path.join(tmp, "evidence"),
        awsAccountId: "123456789012",
        awsOrganizationId: "o-example",
        supabaseOrgId: "supabase-org",
        supabaseProjectRef: "project-ref",
        supabaseAccessToken: { ref: TOKEN_REF, category: "control" },
        ...extra,
      },
      null,
      2,
    )}\n`,
  );
}

async function writeInfisicalBootstrapConfig(tmp: string) {
  await writeResolverConfig(tmp, {
    backend: "infisical",
    host: "https://app.infisical.com",
    projectId: "proj_123",
    defaultEnvironment: "prod",
    clientIdEnv: "INFISICAL_CLIENT_ID",
    clientSecretEnv: "INFISICAL_CLIENT_SECRET",
  });
}

async function writeLocalFileBootstrapConfig(tmp: string) {
  await fsp.mkdir(path.join(tmp, ".local"), { recursive: true });
  await writeResolverConfig(tmp, {
    backend: "local-file",
    file: path.join(tmp, ".local", "bootstrap.json"),
  });
}

async function writeResolverConfig(tmp: string, bootstrap: Record<string, unknown>) {
  await fsp.mkdir(path.join(tmp, "config", "sprinkleref"), { recursive: true });
  await fsp.writeFile(
    path.join(tmp, "config", "sprinkleref", "selected.json"),
    `${JSON.stringify(
      { version: 1, defaultCategory: "bootstrap", categories: { bootstrap } },
      null,
      2,
    )}\n`,
  );
}

async function writeLocalValues(tmp: string, value: unknown) {
  await fsp.mkdir(path.join(tmp, "config", "sprinkleref", "local"), { recursive: true });
  await fsp.writeFile(
    path.join(tmp, "config", "sprinkleref", "local", "values.json"),
    `${JSON.stringify(
      { values: { "control-plane": { supabase: { "management-api-token": value } } } },
      null,
      2,
    )}\n`,
  );
}

async function readSupabaseEvidence(tmp: string) {
  return JSON.parse(
    await fsp.readFile(
      path.join(tmp, "evidence", "check-supabase", "supabase-readiness.json"),
      "utf8",
    ),
  );
}

function stackPath(tmp: string) {
  return path.join(tmp, "stack.json");
}
