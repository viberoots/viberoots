import {
  NOW,
  assert,
  fakeSupabaseFetch,
  fsp,
  path,
  runAwsAccountCommand,
  runInTemp,
  test,
  withControlPlaneArgv,
} from "./aws-account-cli.helpers";

const ACCOUNT_REF = "config://control-plane/aws/account-id";
const ORG_REF = "config://control-plane/aws/organization-id";
type StatusLike = { phases: Record<string, any> };
test("aws-account identity config refs do not enter bootstrap categories", async () => {
  await runInTemp("aws-account-identity-bootstrap-guard", async (tmp) => {
    await writeInfisicalBootstrapConfig(tmp);
    await writeLocalValues(tmp, "unused", undefined);
    await writeStackConfig(tmp, { awsAccountId: { ref: ACCOUNT_REF, category: "bootstrap" } });
    const { status, out } = await runBlockedCheck(tmp);
    const phase = status.phases["check-aws-login"];
    assert.equal(phase.state, "blocked");
    assert.doesNotMatch(phase.message, /bootstrap category must not use an Infisical/);
    assert.doesNotMatch(out.join("\n"), /Bootstrap category:[\s\S]*awsAccountId/);
    assertMissingField(status, "awsAccountId", {
      ref: ACCOUNT_REF,
      destination: "project-shared-config",
      note: /missing in project config values/,
    });
    assert.match((await readInputs(tmp)).inputErrors.awsAccountId, /project config values/);
  });
});
test("aws-account identity local redirects ignore bootstrap categories", async () => {
  await runInTemp("aws-account-identity-local-bootstrap-guard", async (tmp) => {
    await writeInfisicalBootstrapConfig(tmp);
    await writeStackConfig(tmp, { awsOrganizationId: { ref: ORG_REF } });
    await fsp.writeFile(
      path.join(tmp, "projects", "config", "local.json"),
      `${JSON.stringify(
        {
          values: {
            "control-plane": {
              aws: {
                "account-id": "o-ok",
                "organization-id": { ref: ACCOUNT_REF, category: "bootstrap" },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    const { status } = await runBlockedCheck(tmp);
    const inputs = await readInputs(tmp);
    assert.equal(status.phases["check-aws-login"].state, "passed");
    assert.equal(inputs.inputSources.awsOrganizationId.source, "local-values");
    assert.equal(inputs.inputSources.awsOrganizationId.category, undefined);
    assert.equal(inputs.inputSources.awsOrganizationId.redirectRef, ACCOUNT_REF);
  });
});
test("aws-account identity config refs do not resolve through non-Infisical bootstrap category", async () => {
  await runInTemp("aws-account-identity-bootstrap-local-file", async (tmp) => {
    await writeLocalFileBootstrapConfig(tmp, { [ACCOUNT_REF]: "123456789012", [ORG_REF]: "o-ok" });
    await writeLocalValues(tmp, "unused", undefined);
    await writeStackConfig(tmp, {
      awsAccountId: { ref: ACCOUNT_REF, category: "bootstrap" },
      awsOrganizationId: { ref: ORG_REF, category: "bootstrap" },
    });
    const { status } = await runBlockedCheck(tmp);
    assert.equal(status.phases["check-aws-login"].state, "blocked");
    const inputs = await readInputs(tmp);
    assert.equal(inputs.inputSources.awsAccountId.source, "missing");
    assert.equal(inputs.inputSources.awsAccountId.category, undefined);
    assert.equal(inputs.inputSources.awsAccountId.valuePrinted, true);
  });
});
test("aws-account organization id reports unresolved local values as non-secret", async () => {
  await runInTemp("aws-account-org-local-missing", async (tmp) => {
    await writeStackConfig(tmp, { awsOrganizationId: { ref: ORG_REF } });
    await writeLocalValues(tmp, "organization-id", "");
    const { status } = await runBlockedCheck(tmp);
    assertMissingField(status, "awsOrganizationId", {
      ref: ORG_REF,
      destination: "project-local-config",
      note: /AWS Organizations id/,
      source: "local-values",
    });
    assert.equal(status.phases["check-aws-login"].state, "blocked");
  });
});
test("aws-account organization id reports unresolved shared project config refs as non-secret", async () => {
  await runInTemp("aws-account-org-shared-missing", async (tmp) => {
    await writeControlLocalFileConfig(tmp, {});
    await writeLocalValues(tmp, "unused", undefined);
    await writeStackConfig(tmp, { awsOrganizationId: { ref: ORG_REF, category: "control" } });
    const { status } = await runBlockedCheck(tmp);
    assertMissingField(status, "awsOrganizationId", {
      ref: ORG_REF,
      destination: "project-shared-config",
      note: /is missing in project config values/,
      source: "missing",
    });
    assert.equal(status.phases["check-aws-login"].state, "blocked");
  });
});

async function runBlockedCheck(tmp: string) {
  const out: string[] = [];
  const status = await runCheckWithExitReset(tmp, out);
  return { status, out };
}

async function runCheckWithExitReset(tmp: string, out: string[]) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await withControlPlaneArgv(["aws-account", "check", "--config", stackPath(tmp)], () =>
      runAwsAccountCommand({
        cwd: tmp,
        now: () => NOW,
        env: { SUPABASE_ACCESS_TOKEN: "test-token" },
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

async function writeStackConfig(tmp: string, extra: Record<string, unknown>) {
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
        ...extra,
      },
      null,
      2,
    )}\n`,
  );
}

async function writeInfisicalBootstrapConfig(tmp: string) {
  await writeResolverConfig(tmp, {
    version: 1,
    defaultCategory: "bootstrap",
    categories: {
      bootstrap: {
        backend: "infisical",
        host: "https://app.infisical.com",
        projectId: "proj_123",
        defaultEnvironment: "prod",
        clientIdEnv: "INFISICAL_CLIENT_ID",
        clientSecretEnv: "INFISICAL_CLIENT_SECRET",
      },
    },
  });
}

async function writeLocalFileBootstrapConfig(tmp: string, values: Record<string, string>) {
  const file = path.join(tmp, ".local", "bootstrap.json");
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(values, null, 2)}\n`);
  await writeResolverConfig(tmp, {
    version: 1,
    defaultCategory: "bootstrap",
    categories: { bootstrap: { backend: "local-file", file } },
  });
}

async function writeControlLocalFileConfig(tmp: string, values: Record<string, string>) {
  const file = path.join(tmp, ".local", "control.json");
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(values, null, 2)}\n`);
  await writeResolverConfig(tmp, {
    version: 1,
    defaultCategory: "control",
    categories: { control: { backend: "local-file", file } },
  });
}

async function writeResolverConfig(tmp: string, config: Record<string, unknown>) {
  await fsp.mkdir(path.join(tmp, "projects", "config"), { recursive: true });
  await fsp.writeFile(
    path.join(tmp, "projects", "config", "shared.json"),
    `${JSON.stringify(
      { schemaVersion: "viberoots-project-config@1", sprinkleref: config },
      null,
      2,
    )}\n`,
  );
}

async function writeLocalValues(tmp: string, leaf: string, value: unknown) {
  await fsp.mkdir(path.join(tmp, "projects", "config"), { recursive: true });
  await fsp.writeFile(
    path.join(tmp, "projects", "config", "local.json"),
    `${JSON.stringify({ values: { "control-plane": { aws: { [leaf]: value } } } }, null, 2)}\n`,
  );
}

async function readInputs(tmp: string) {
  return JSON.parse(await fsp.readFile(path.join(tmp, "evidence", "inputs.json"), "utf8"));
}

function assertMissingField(
  status: StatusLike,
  field: string,
  expected: {
    ref: string;
    destination: string;
    category?: string;
    note: RegExp;
    source?: string;
  },
) {
  const found = status.phases["check-aws-login"].missingConfigFields.find(
    (entry) => entry.field === field,
  );
  assert.equal(found?.ref, expected.ref);
  assert.equal(found?.destination, expected.destination);
  assert.equal(found?.category, expected.category);
  assert.match(found?.note || "", expected.note);
  if (expected.source) {
    const source = status.phases["check-aws-login"].resolvedInputSources[field];
    assert.equal(source.source, expected.source);
    assert.equal(source.valuePrinted, true);
  }
  assert.doesNotMatch(JSON.stringify(found), /secretValuePrinted|SUPABASE_ACCESS_TOKEN/);
}

function stackPath(tmp: string) {
  return path.join(tmp, "stack.json");
}
