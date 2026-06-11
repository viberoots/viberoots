import {
  assert,
  fakeSupabaseFetch,
  fsp,
  path,
  parseStackField,
  readAwsAccountConfig,
  readSupabaseEvidence,
  resolveStackRef,
  runAwsAccountCommand,
  runCheckForMissingToken,
  runInTemp,
  runSprinkleRefCli,
  test,
  withControlPlaneArgv,
  writeJson,
  writeLocalValues,
  writeRemote,
  writeStack,
} from "./aws-account-local-sprinkleref.helpers";

test("aws-account resolver handles config refs through project config", async () => {
  await runInTemp("aws-account-project-config-refs", async (tmp) => {
    const ref = "config://control-plane/aws/account-id";
    const orgRef = "config://control-plane/aws/organization-id";
    await writeStack(tmp, { domain: "example.com", awsAccountId: { ref } });
    let config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, undefined);
    assert.equal(config.inputSources.awsAccountId.source, "missing");
    assert.match(config.inputErrors.awsAccountId, /missing in project config values/);
    await writeJson(path.join(tmp, "projects/config/shared.json"), {
      schemaVersion: "viberoots-project-config@1",
      values: { "control-plane": { aws: { "account-id": "shared-id" } } },
    });
    config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, "shared-id");
    assert.equal(config.inputSources.awsAccountId.source, "local-values");
    await writeLocalValues(tmp, { "control-plane": { aws: { "account-id": "local-id" } } });
    config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, "local-id");
    await writeLocalValues(tmp, {
      "control-plane": { aws: { "account-id": { ref: orgRef }, "organization-id": "local-org" } },
    });
    const chained = await resolveStackRef(tmp, ref);
    assert.equal(chained.value, "local-org");
    assert.equal(chained.source.source, "local-values");
  });
});

test("aws-account check points missing bootstrap token refs at bootstrap category", async () => {
  await runInTemp("aws-account-missing-bootstrap-token", async (tmp) => {
    const ref = "secret://control-plane/supabase/management-api-token";
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: "123456789012",
      supabaseOrgId: "supabase-org",
      supabaseProjectRef: "project-ref",
      supabaseAccessToken: { ref, category: "bootstrap" },
    });
    await writeJson(path.join(tmp, "projects/config/shared.json"), {
      schemaVersion: "viberoots-project-config@1",
      sprinkleref: {
        version: 1,
        defaultCategory: "control",
        categories: {
          control: { backend: "local-file", file: path.join(tmp, ".local/control.json") },
          bootstrap: { backend: "local-file", file: path.join(tmp, ".local/bootstrap.json") },
        },
      },
    });
    const out = await runCheckForMissingToken(tmp);
    assert.match(out, /BLOCKED check-supabase/);
    assert.match(out, /Missing Values\n  Bootstrap category:/);
    assert.doesNotMatch(out, /Shared project config:[\s\S]*supabaseAccessToken/);
    assert.doesNotMatch(out, /Local operator config:[\s\S]*supabaseAccessToken/);
  });
});

test("aws-account check points missing local bootstrap redirects at bootstrap category", async () => {
  await runInTemp("aws-account-missing-bootstrap-token-redirect", async (tmp) => {
    const ref = "secret://control-plane/supabase/management-api-token";
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: "123456789012",
      supabaseOrgId: "supabase-org",
      supabaseProjectRef: "project-ref",
      supabaseAccessToken: { ref },
    });
    await writeJson(path.join(tmp, "projects/config/shared.json"), {
      schemaVersion: "viberoots-project-config@1",
      sprinkleref: {
        version: 1,
        defaultCategory: "control",
        categories: {
          control: { backend: "local-file", file: path.join(tmp, ".local/control.json") },
          bootstrap: { backend: "local-file", file: path.join(tmp, ".local/bootstrap.json") },
        },
      },
    });
    await writeLocalValues(tmp, {
      "control-plane": { supabase: { "management-api-token": { ref, category: "bootstrap" } } },
    });
    const out = await runCheckForMissingToken(tmp);
    assert.match(out, /Missing Values\n  Bootstrap category:/);
    const evidence = await readSupabaseEvidence(path.join(tmp, "evidence-missing-token"));
    assert.equal(evidence.supabaseAccessToken.source, "missing");
    assert.equal(evidence.supabaseAccessToken.ref, ref);
    assert.equal(evidence.supabaseAccessToken.category, "bootstrap");
    assert.match(evidence.supabaseAccessToken.localValuesPath, /projects\/config\/local\.json$/);
    assert.match(evidence.supabaseAccessToken.backend, /local-file/);
    assert.equal(evidence.supabaseAccessToken.valuePrinted, false);
  });
});

test("aws-account check keeps non-bootstrap missing token refs on resolver guidance", async () => {
  await runInTemp("aws-account-missing-control-token", async (tmp) => {
    const ref = "secret://control-plane/supabase/management-api-token";
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: "123456789012",
      supabaseOrgId: "supabase-org",
      supabaseProjectRef: "project-ref",
      supabaseAccessToken: { ref },
    });
    await writeRemote(tmp, "control", {});
    await writeLocalValues(tmp, {
      "control-plane": { supabase: { "management-api-token": { ref } } },
    });
    const out = await runCheckForMissingToken(tmp);
    assert.match(out, /Secret backend:[\s\S]*supabaseAccessToken/);
    assert.doesNotMatch(out, /Bootstrap category:[\s\S]*supabaseAccessToken/);
    const evidence = await readSupabaseEvidence(path.join(tmp, "evidence-missing-token"));
    assert.equal(evidence.supabaseAccessToken.category, "control");
    assert.match(evidence.supabaseAccessToken.localValuesPath, /projects\/config\/local\.json$/);
  });
});

test("aws-account check ignores default bootstrap category for token guidance", async () => {
  await runInTemp("aws-account-default-bootstrap-token-guidance", async (tmp) => {
    const ref = "secret://control-plane/supabase/management-api-token";
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: "123456789012",
      supabaseOrgId: "supabase-org",
      supabaseProjectRef: "project-ref",
      supabaseAccessToken: { ref },
    });
    await writeRemote(tmp, "bootstrap", {});
    const out = await runCheckForMissingToken(tmp);
    assert.match(out, /Secret backend:[\s\S]*supabaseAccessToken/);
    assert.doesNotMatch(out, /Bootstrap category:[\s\S]*supabaseAccessToken/);
    const evidence = await readSupabaseEvidence(path.join(tmp, "evidence-missing-token"));
    assert.equal(evidence.supabaseAccessToken.category, "bootstrap");
    assert.equal(evidence.supabaseAccessToken.categoryExplicit, false);
  });
});

test("aws-account source precedence favors cli and inline over resolvers", async () => {
  await runInTemp("aws-account-source-precedence", async (tmp) => {
    const ref = "secret://control-plane/supabase/management-api-token";
    const accountRef = "config://control-plane/aws/account-id";
    await writeRemote(tmp, "control", { [ref]: "remote-token", [accountRef]: "remote-id" });
    await writeLocalValues(tmp, {
      "control-plane": {
        aws: { "account-id": "local-id" },
        supabase: { "management-api-token": "plain-local-token" },
      },
    });
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: "stack-id",
      awsOrganizationId: "o-example",
      supabaseOrgId: "supabase-org",
      supabaseProjectRef: "project-ref",
      supabaseAccessToken: { ref },
    });
    await withControlPlaneArgv(["aws-account", "check", "--aws-account-id", "cli-id"], async () => {
      const config = await readAwsAccountConfig(tmp);
      assert.equal(config.awsAccountId, "cli-id");
      assert.equal(config.inputSources.awsAccountId.source, "cli");
    });
    await withControlPlaneArgv(["aws-account", "check"], async () => {
      const config = await readAwsAccountConfig(tmp);
      assert.equal(config.awsAccountId, "stack-id");
      assert.equal(config.inputSources.awsAccountId.source, "inline");
    });
    await assert.rejects(
      () => resolveStackRef(tmp, ref, { secret: true }),
      /must not be plaintext/,
    );
    const out: string[] = [];
    await withControlPlaneArgv(["aws-account", "check"], () =>
      runAwsAccountCommand({
        cwd: tmp,
        env: { SUPABASE_ACCESS_TOKEN: "env-token" },
        now: () => new Date("2026-06-02T12:00:00.000Z"),
        httpFetch: fakeSupabaseFetch,
        stdout: (text) => out.push(text),
        toolResolver: (tool) => `/nix/store/fake-${tool}/bin/${tool}`,
        commandRunner: async () => ({
          stdout: JSON.stringify({ Account: "stack-id" }),
          stderr: "",
        }),
      }),
    );
    assert.match(
      out.join("\n"),
      /supabaseAccessToken: environment \(redacted\)\n    env: SUPABASE_ACCESS_TOKEN/,
    );
  });
});

test("sprinkleref --init-local preserves values and writes no plaintext token", async () => {
  await runInTemp("sprinkleref-init-local", async (tmp) => {
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      await writeLocalValues(tmp, { "control-plane": { aws: { "account-id": "kept" } } });
      const out: string[] = [];
      await runSprinkleRefCli({ argv: ["--init-local"], stdout: (text) => out.push(text) });
      const values = JSON.parse(
        await fsp.readFile(path.join(tmp, "projects/config/local.json"), "utf8"),
      );
      assert.match(out[0] || "", /projects\/config\/local\.json/);
      assert.equal(values.values["control-plane"].aws["account-id"], "kept");
      assert.equal(values.values["control-plane"].aws["organization-id"], "");
      assert.equal(values.values["control-plane"].supabase["org-id"], "");
      assert.equal(values.values["control-plane"].supabase["project-ref"], "");
      assert.deepEqual(values.values["control-plane"].supabase["management-api-token"], {
        ref: "secret://control-plane/supabase/management-api-token",
      });
      assert.match(
        out.join("\n"),
        /"nextCommand": "sprinkleref --update secret:\/\/control-plane\/supabase\/management-api-token --create-missing"/,
      );
      assert.doesNotMatch(out.join("\n"), /optionalBootstrapCommand|--category bootstrap/);
      assert.doesNotMatch(JSON.stringify(values), /token-value|plain-token/);
    } finally {
      process.chdir(cwd);
    }
  });
});
