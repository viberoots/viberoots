import {
  AWS_ACCOUNT_STACK_CONFIG_FIELDS_WITHOUT_DEFAULTS,
  NOW,
  assert,
  exists,
  fakeSupabaseFetch,
  fsp,
  path,
  readAwsAccountConfig,
  removeCanonicalStackConfig,
  runAwsAccountCommand,
  runInTemp,
  selectedControlPlaneCommand,
  test,
  withControlPlaneArgv,
  withCwd,
} from "./aws-account-cli.helpers";

test("aws-account requires explicit domain unless config or evidence dir is supplied", async () => {
  await runInTemp("aws-account-requires-domain", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    await withControlPlaneArgv(["aws-account", "check"], async () => {
      await assert.rejects(
        () => readAwsAccountConfig(tmp),
        /add --domain <domain>.*"domain": ".*--evidence-dir <dir>/,
      );
    });
  });
});

test("aws-account defaults derive first-stack hosts and evidence directory from supplied domain", async () => {
  await runInTemp("aws-account-defaults", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    await withControlPlaneArgv(["aws-account", "check", "--domain", "example.com"], async () => {
      const config = await readAwsAccountConfig(tmp);
      assert.equal(config.stackName, "control");
      assert.equal(config.region, "us-east-1");
      assert.equal(config.domain, "example.com");
      assert.equal(config.serviceHost, "deploy.control.example.com");
      assert.equal(config.authHost, "auth.control.example.com");
      assert.equal(config.privateDbHost, "db.control.example.com");
      assert.equal(config.evidenceDir, "buck-out/aws-account/control-example.com");
      assert.equal(
        config.stateBucketName,
        "deployment-control-plane-control-example-com-tofu-state",
      );
      assert.equal(
        config.stateLockTableName,
        "deployment-control-plane-control-example-com-tofu-locks",
      );
      assert.equal(config.backendStateKey, "aws-foundation/deployment-control-plane.tfstate");
    });
  });
});

test("aws-account config file parameterizes second control-plane stacks", async () => {
  await runInTemp("aws-account-config", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    const configPath = path.join(tmp, "second.json");
    await fsp.writeFile(
      configPath,
      `${JSON.stringify(
        {
          stackName: "control-eu",
          region: "eu-west-1",
          domain: "example.org",
          awsAccountId: "210987654321",
          awsOrganizationId: "o-example",
          supabaseOrgId: "supabase-org",
          supabaseProjectRef: "project-ref",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await withControlPlaneArgv(["aws-account", "check", "--config", configPath], async () => {
      const config = await readAwsAccountConfig(tmp);
      assert.equal(config.stackName, "control-eu");
      assert.equal(config.region, "eu-west-1");
      assert.equal(config.domain, "example.org");
      assert.equal(config.serviceHost, "deploy.control-eu.example.org");
      assert.equal(config.evidenceDir, "buck-out/aws-account/control-eu-example.org");
      assert.equal(config.awsOrganizationId, "o-example");
      assert.equal(
        config.stateBucketName,
        "deployment-control-plane-control-eu-example-org-tofu-state",
      );
    });
  });
});

test("aws-account config-init writes canonical stack config with empty unknowns", async () => {
  await runInTemp("aws-account-config-init-empty", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    const out: string[] = [];
    await withControlPlaneArgv(["aws-account", "config-init"], () =>
      runAwsAccountCommand({ cwd: tmp, stdout: (text) => out.push(text) }),
    );
    const configPath = path.join(tmp, "config", "control-plane", "stack.json");
    const config = JSON.parse(await fsp.readFile(configPath, "utf8")) as Record<string, unknown>;
    assert.ok(out[0]?.includes("config/control-plane/stack.json"));
    assert.equal(config.schemaVersion, "aws-account-stack-config@1");
    assert.equal(config.domain, "");
    assert.deepEqual(config.awsAccountId, {
      ref: "config://control-plane/aws/account-id",
    });
    assert.deepEqual(config.awsOrganizationId, {
      ref: "config://control-plane/aws/organization-id",
    });
    assert.deepEqual(config.supabaseOrgId, {
      ref: "config://control-plane/supabase/org-id",
    });
    assert.deepEqual(config.supabaseProjectRef, {
      ref: "config://control-plane/supabase/project-ref",
    });
    assert.deepEqual(config.supabaseAccessToken, {
      ref: "secret://control-plane/supabase/management-api-token",
      category: "control",
    });
    assert.equal(Object.hasOwn(config, "stackName"), false);
    assert.equal(Object.hasOwn(config, "region"), false);
    assert.equal(Object.hasOwn(config, "expectedAwsRoleArn"), false);
    assert.equal(Object.hasOwn(config, "service"), false);
    assert.equal(Object.hasOwn(config, "authService"), false);
    assert.equal(Object.hasOwn(config, "privateDbService"), false);
    assert.equal(Object.hasOwn(config, "serviceHost"), false);
    assert.equal(Object.hasOwn(config, "authHost"), false);
    assert.equal(Object.hasOwn(config, "privateDbHost"), false);
    assert.equal(Object.hasOwn(config, "evidenceDir"), false);
    assert.equal(Object.hasOwn(config, "stateBucketName"), false);
    assert.equal(Object.hasOwn(config, "stateLockTableName"), false);
    assert.equal(Object.hasOwn(config, "backendStateKey"), false);
    assert.equal(Object.hasOwn(config, "supabasePlan"), false);
    assert.equal(Object.hasOwn(config, "supabaseAccessTokenRef"), false);
    assert.equal(Object.hasOwn(config, "supabaseAccessTokenEnv"), false);
    assert.equal(Object.hasOwn(config, "supabaseAccessTokenRefCategory"), false);
    assert.equal(Object.hasOwn(config, "supabaseApiBaseUrl"), false);
    for (const field of AWS_ACCOUNT_STACK_CONFIG_FIELDS_WITHOUT_DEFAULTS) {
      assert.ok(Object.hasOwn(config, field), `${field} should be written to stack.json`);
    }
  });
});

test("aws-account config-init writes only explicit non-default overrides", async () => {
  await runInTemp("aws-account-config-init-non-defaults", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    await withControlPlaneArgv(
      [
        "aws-account",
        "config-init",
        "--domain",
        "example.com",
        "--region",
        "eu-west-1",
        "--expected-aws-role-arn",
        "arn:aws:sts::123456789012:assumed-role/bootstrap/operator",
        "--service",
        "control",
        "--supabase-access-token-env",
        "CONTROL_SUPABASE_TOKEN",
      ],
      () => runAwsAccountCommand({ cwd: tmp, stdout: () => undefined }),
    );
    const configPath = path.join(tmp, "config", "control-plane", "stack.json");
    const config = JSON.parse(await fsp.readFile(configPath, "utf8")) as Record<string, unknown>;
    assert.equal(config.domain, "example.com");
    assert.equal(config.region, "eu-west-1");
    assert.equal(
      config.expectedAwsRoleArn,
      "arn:aws:sts::123456789012:assumed-role/bootstrap/operator",
    );
    assert.equal(config.service, "control");
    assert.equal(config.supabaseAccessTokenEnv, "CONTROL_SUPABASE_TOKEN");
    assert.equal(Object.hasOwn(config, "stackName"), false);
    assert.equal(Object.hasOwn(config, "serviceHost"), false);
    assert.equal(Object.hasOwn(config, "supabaseAccessTokenRefCategory"), false);
  });
});

test("aws-account rejects operator-supplied Supabase plan inputs", async () => {
  await runInTemp("aws-account-rejects-supabase-plan", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    await withControlPlaneArgv(
      ["aws-account", "config-init", "--supabase-plan", "Team"],
      async () => {
        await assert.rejects(
          () => runAwsAccountCommand({ cwd: tmp, stdout: () => undefined }),
          /supabasePlan is not a stack config input/,
        );
      },
    );
    const configPath = path.join(tmp, "stack.json");
    await fsp.writeFile(
      configPath,
      JSON.stringify(
        {
          domain: "example.com",
          supabasePlan: "Team",
        },
        null,
        2,
      ),
      "utf8",
    );
    await withControlPlaneArgv(["aws-account", "check", "--config", configPath], async () => {
      await assert.rejects(
        () => readAwsAccountConfig(tmp),
        /supabasePlan is not a stack config input/,
      );
    });
  });
});
