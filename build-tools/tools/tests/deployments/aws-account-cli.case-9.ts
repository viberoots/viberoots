import {
  assert,
  removeCanonicalStackConfig,
  runAwsAccountCommand,
  runInTemp,
  test,
  withControlPlaneArgv,
} from "./aws-account-cli.helpers";

test("aws-account rejects stale Supabase token-ref CLI inputs", async () => {
  await runInTemp("aws-account-rejects-token-ref-flags", async (tmp) => {
    await removeCanonicalStackConfig(tmp);
    await assertStaleFlagsRejected(tmp, [
      "aws-account",
      "config-init",
      "--domain",
      "example.com",
      "--supabase-access-token-ref",
      "secret://control-plane/supabase/management-api-token",
      "--supabase-access-token-ref-category",
      "control",
    ]);
    await assertStaleFlagsRejected(tmp, [
      "aws-account",
      "check",
      "--domain",
      "example.com",
      "--supabase-access-token-ref-category",
      "control",
    ]);
  });
});

async function assertStaleFlagsRejected(tmp: string, argv: string[]): Promise<void> {
  await withControlPlaneArgv(argv, async () => {
    await assert.rejects(
      () => runAwsAccountCommand({ cwd: tmp, stdout: () => undefined }),
      /supabaseAccessTokenRef CLI inputs are no longer supported/,
    );
  });
}
