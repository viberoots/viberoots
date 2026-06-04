import {
  assert,
  readAwsAccountConfig,
  runInTemp,
  test,
  writeLocalValues,
  writeResolver,
  writeStack,
} from "./aws-account-local-sprinkleref.helpers";

const ACCOUNT_REF = "config://control-plane/aws/account-id";
const ORG_REF = "config://control-plane/aws/organization-id";

test("aws-account explicit stack categories prevent different-ref local redirects", async () => {
  await runInTemp("aws-account-explicit-category-blocks-target-redirect", async (tmp) => {
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: { ref: ACCOUNT_REF, category: "ops" },
    });
    await writeResolver(tmp, "main", {
      main: {},
      ops: { [ACCOUNT_REF]: "ops-account-id", [ORG_REF]: "ops-org-id" },
    });
    await writeLocalValues(tmp, {
      "control-plane": {
        aws: { "account-id": { ref: ORG_REF } },
      },
    });
    const config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, "ops-account-id");
    assert.equal(config.inputSources.awsAccountId.ref, ACCOUNT_REF);
    assert.equal(config.inputSources.awsAccountId.category, "ops");
    assert.equal(config.inputSources.awsAccountId.categoryExplicit, true);
    assert.match(
      config.inputSources.awsAccountId.localValuesPath || "",
      /projects\/config\/local\.json$/,
    );
  });
});

test("aws-account uncategorized stack refs allow different-ref local redirects", async () => {
  await runInTemp("aws-account-uncategorized-allows-target-redirect", async (tmp) => {
    await writeStack(tmp, {
      domain: "example.com",
      awsAccountId: { ref: ACCOUNT_REF },
    });
    await writeResolver(tmp, "main", {
      main: { [ACCOUNT_REF]: "main-account-id", [ORG_REF]: "main-org-id" },
    });
    await writeLocalValues(tmp, {
      "control-plane": {
        aws: { "account-id": { ref: ORG_REF } },
      },
    });
    const config = await readAwsAccountConfig(tmp);
    assert.equal(config.awsAccountId, "main-org-id");
    assert.equal(config.inputSources.awsAccountId.ref, ACCOUNT_REF);
    assert.equal(config.inputSources.awsAccountId.redirectRef, ORG_REF);
    assert.equal(config.inputSources.awsAccountId.redirectSource?.ref, ORG_REF);
    assert.equal(config.inputSources.awsAccountId.category, "main");
    assert.equal(config.inputSources.awsAccountId.categoryExplicit, false);
  });
});
