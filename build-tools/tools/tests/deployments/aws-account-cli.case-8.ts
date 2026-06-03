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

type StatusLike = {
  phases: {
    "check-aws-login": {
      missingConfigFields: MissingField[];
      resolvedInputSources: Record<string, { source: string; valuePrinted: boolean }>;
    };
  };
};

type MissingField = {
  field: string;
  destination: string;
  ref: string;
  category?: string;
  note?: string;
};
test("aws-account identity refs surface direct bootstrap guard failures", async () => {
  await runInTemp("aws-account-identity-bootstrap-guard", async (tmp) => {
    await writeInfisicalBootstrapConfig(tmp);
    await writeStackConfig(tmp, { awsAccountId: { ref: ACCOUNT_REF, category: "bootstrap" } });
    const { status, out } = await runBlockedCheck(tmp);
    const phase = status.phases["check-aws-login"];
    assert.equal(phase.state, "blocked");
    assert.match(phase.message, /bootstrap category must not use an Infisical/);
    assert.match(out.join("\n"), /Bootstrap category:[\s\S]*awsAccountId/);
    assertMissingField(status, "awsAccountId", {
      ref: ACCOUNT_REF,
      category: "bootstrap",
      destination: "bootstrap-category",
      note: /bootstrap category must not use an Infisical/,
    });
    assert.match((await readInputs(tmp)).inputErrors.awsAccountId, /Infisical/);
  });
});

test("aws-account identity local redirects apply bootstrap guard", async () => {
  await runInTemp("aws-account-identity-local-bootstrap-guard", async (tmp) => {
    await writeInfisicalBootstrapConfig(tmp);
    await writeStackConfig(tmp, { awsOrganizationId: { ref: ORG_REF } });
    await writeLocalValues(tmp, "organization-id", { ref: ORG_REF, category: "bootstrap" });
    const { status } = await runBlockedCheck(tmp);
    assertMissingField(status, "awsOrganizationId", {
      ref: ORG_REF,
      category: "bootstrap",
      destination: "bootstrap-category",
      note: /bootstrap category must not use an Infisical/,
    });
    assert.equal(status.phases["check-aws-login"].state, "blocked");
  });
});

test("aws-account identity refs allow non-Infisical bootstrap category", async () => {
  await runInTemp("aws-account-identity-bootstrap-local-file", async (tmp) => {
    await writeLocalFileBootstrapConfig(tmp, { [ACCOUNT_REF]: "123456789012", [ORG_REF]: "o-ok" });
    await writeStackConfig(tmp, {
      awsAccountId: { ref: ACCOUNT_REF, category: "bootstrap" },
      awsOrganizationId: { ref: ORG_REF, category: "bootstrap" },
    });
    const { status } = await runBlockedCheck(tmp);
    assert.equal(status.phases["check-aws-login"].state, "passed");
    const inputs = await readInputs(tmp);
    assert.equal(inputs.inputSources.awsAccountId.source, "sprinkleref");
    assert.equal(inputs.inputSources.awsAccountId.category, "bootstrap");
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
      destination: "local-values-or-shared-resolver",
      note: /AWS Organizations id/,
      source: "local-values",
    });
    assert.equal(status.phases["check-aws-login"].state, "blocked");
  });
});

test("aws-account organization id reports unresolved shared resolver paths as non-secret", async () => {
  await runInTemp("aws-account-org-shared-missing", async (tmp) => {
    await writeControlLocalFileConfig(tmp, {});
    await writeStackConfig(tmp, { awsOrganizationId: { ref: ORG_REF, category: "control" } });
    const { status } = await runBlockedCheck(tmp);
    assertMissingField(status, "awsOrganizationId", {
      ref: ORG_REF,
      category: "control",
      destination: "local-values-or-shared-resolver",
      note: /is missing in SprinkleRef category control/,
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
  await fsp.mkdir(path.join(tmp, "config", "sprinkleref"), { recursive: true });
  await fsp.writeFile(
    path.join(tmp, "config", "sprinkleref", "selected.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

async function writeLocalValues(tmp: string, leaf: string, value: unknown) {
  await fsp.mkdir(path.join(tmp, "config", "sprinkleref", "local"), { recursive: true });
  await fsp.writeFile(
    path.join(tmp, "config", "sprinkleref", "local", "values.json"),
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
