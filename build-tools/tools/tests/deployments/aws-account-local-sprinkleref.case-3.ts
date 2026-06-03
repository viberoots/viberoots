import {
  assert,
  path,
  readAwsAccountConfig,
  readSupabaseEvidence,
  runAwsAccountCommand,
  runCheckForMissingToken,
  runInTemp,
  test,
  withControlPlaneArgv,
  writeLocalValues,
  writeResolver,
  writeStack,
} from "./aws-account-local-sprinkleref.helpers";

const ACCOUNT_REF = "config://control-plane/aws/account-id";
const TOKEN_REF = "secret://control-plane/supabase/management-api-token";

test("aws-account bare setup refs do not infer control from ref prefix", async () => {
  await runInTemp("aws-account-no-prefix-category-inference", async (tmp) => {
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: { ref: ACCOUNT_REF },
    });
    await writeResolver(tmp, "main", {
      main: { [ACCOUNT_REF]: "main-id" },
      control: { [ACCOUNT_REF]: "control-id" },
    });
    const config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, "main-id");
    assert.equal(config.inputSources.awsAccountId.category, "main");
    assert.equal(config.inputSources.awsAccountId.categoryExplicit, false);
  });
});

test("aws-account config-init refs resolve through explicit control category", async () => {
  await runInTemp("aws-account-config-init-explicit-control-category", async (tmp) => {
    await writeResolver(tmp, "main", {
      main: { [ACCOUNT_REF]: "main-id" },
      control: { [ACCOUNT_REF]: "control-id" },
    });
    await withControlPlaneArgv(["aws-account", "config-init", "--domain", "example.com"], () =>
      runAwsAccountCommand({ cwd: tmp, stdout: () => undefined }),
    );
    const config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, "control-id");
    assert.deepEqual(config.inputSources.awsAccountId, {
      source: "sprinkleref",
      ref: ACCOUNT_REF,
      category: "control",
      backend: `local-file ${path.join(tmp, ".local/control.json")}`,
      categoryExplicit: true,
      valuePrinted: true,
    });
  });
});

test("aws-account explicit stack categories override generated control category", async () => {
  await runInTemp("aws-account-explicit-stack-category", async (tmp) => {
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: { ref: ACCOUNT_REF, category: "bootstrap" },
    });
    await writeResolver(tmp, "main", {
      main: { [ACCOUNT_REF]: "main-id" },
      control: { [ACCOUNT_REF]: "control-id" },
      bootstrap: { [ACCOUNT_REF]: "bootstrap-id" },
    });
    const config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, "bootstrap-id");
    assert.equal(config.inputSources.awsAccountId.category, "bootstrap");
    assert.equal(config.inputSources.awsAccountId.categoryExplicit, true);
  });
});

test("aws-account arbitrary explicit stack categories override local redirects", async () => {
  await runInTemp("aws-account-explicit-arbitrary-category", async (tmp) => {
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: { ref: ACCOUNT_REF, category: "ops" },
    });
    await writeResolver(tmp, "main", {
      main: { [ACCOUNT_REF]: "main-id" },
      control: { [ACCOUNT_REF]: "control-id" },
      ops: { [ACCOUNT_REF]: "ops-id" },
    });
    await writeLocalValues(tmp, {
      "control-plane": { aws: { "account-id": { ref: ACCOUNT_REF, category: "control" } } },
    });
    const config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, "ops-id");
    assert.equal(config.inputSources.awsAccountId.category, "ops");
    assert.equal(config.inputSources.awsAccountId.categoryExplicit, true);
    assert.match(
      config.inputSources.awsAccountId.localValuesPath || "",
      /config\/sprinkleref\/local\/values\.json$/,
    );
  });
});

test("aws-account explicit stack categories override local scalar and value entries", async () => {
  await runInTemp("aws-account-explicit-category-over-local-values", async (tmp) => {
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: { ref: ACCOUNT_REF, category: "ops" },
    });
    await writeResolver(tmp, "main", {
      main: {},
      ops: { [ACCOUNT_REF]: "ops-id" },
    });
    await writeLocalValues(tmp, {
      "control-plane": { aws: { "account-id": "local-id" } },
    });
    let config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, "ops-id");
    assert.equal(config.inputSources.awsAccountId.source, "sprinkleref");
    await writeLocalValues(tmp, {
      "control-plane": { aws: { "account-id": { value: "local-id" } } },
    });
    config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, "ops-id");
    assert.equal(config.inputSources.awsAccountId.category, "ops");
  });
});

test("aws-account uncategorized stack refs remain local first for scalar and value entries", async () => {
  await runInTemp("aws-account-uncategorized-local-values", async (tmp) => {
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: { ref: ACCOUNT_REF },
    });
    await writeResolver(tmp, "main", {
      main: { [ACCOUNT_REF]: "remote-id" },
    });
    await writeLocalValues(tmp, {
      "control-plane": { aws: { "account-id": "scalar-id" } },
    });
    let config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, "scalar-id");
    assert.equal(
      config.inputSources.awsAccountId.localValuesEntryPath,
      "values.control-plane.aws.account-id",
    );
    await writeLocalValues(tmp, {
      "control-plane": { aws: { "account-id": { value: "object-id" } } },
    });
    config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, "object-id");
    assert.equal(config.inputSources.awsAccountId.source, "local-values");
    assert.equal(
      config.inputSources.awsAccountId.localValuesEntryPath,
      "values.control-plane.aws.account-id",
    );
  });
});

test("aws-account local redirects cannot override explicit token category", async () => {
  await runInTemp("aws-account-explicit-token-category-hardening", async (tmp) => {
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: "123456789012",
      supabaseOrgId: "supabase-org",
      supabaseProjectRef: "project-ref",
      supabaseAccessToken: { ref: TOKEN_REF, category: "control" },
    });
    await writeResolver(tmp, "main", {
      control: {},
      bootstrap: { [TOKEN_REF]: "bootstrap-token" },
    });
    await writeLocalValues(tmp, {
      "control-plane": {
        supabase: { "management-api-token": { ref: TOKEN_REF, category: "bootstrap" } },
      },
    });
    const out = await runCheckForMissingToken(tmp);
    assert.match(out, /Local values or shared resolver refs:[\s\S]*supabaseAccessToken/);
    assert.doesNotMatch(out, /Bootstrap category:[\s\S]*supabaseAccessToken/);
    const evidence = await readSupabaseEvidence(path.join(tmp, "evidence-missing-token"));
    assert.equal(evidence.supabaseAccessToken.source, "missing");
    assert.equal(evidence.supabaseAccessToken.category, "control");
    assert.equal(evidence.supabaseAccessToken.categoryExplicit, true);
    assert.match(
      evidence.supabaseAccessToken.localValuesPath,
      /config\/sprinkleref\/local\/values\.json$/,
    );
    assert.equal(
      evidence.supabaseAccessToken.localValuesEntryPath,
      "values.control-plane.supabase.management-api-token",
    );
    assert.doesNotMatch(JSON.stringify(evidence), /bootstrap-token/);
  });
});

test("aws-account malformed local redirect categories fail closed", async () => {
  await runInTemp("aws-account-malformed-local-redirect-category", async (tmp) => {
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: { ref: ACCOUNT_REF },
    });
    await writeResolver(tmp, "main", {
      main: { [ACCOUNT_REF]: "main-id" },
      control: { [ACCOUNT_REF]: "control-id" },
    });
    await writeLocalValues(tmp, {
      "control-plane": { aws: { "account-id": { ref: ACCOUNT_REF, category: 123 } } },
    });
    await assert.rejects(
      () => readAwsAccountConfig(tmp),
      /config:\/\/control-plane\/aws\/account-id local redirect category must be a string/,
    );
  });
});

test("aws-account explicit unknown categories fail closed", async () => {
  await runInTemp("aws-account-explicit-unknown-category", async (tmp) => {
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: { ref: ACCOUNT_REF, category: "unknown" },
    });
    await writeResolver(tmp, "main", {
      main: { [ACCOUNT_REF]: "main-id" },
      control: { [ACCOUNT_REF]: "control-id" },
    });
    const config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, undefined);
    assert.match(config.inputSources.awsAccountId.category, /unknown/);
    assert.match(config.inputSources.awsAccountId.source, /missing/);
  });
});
