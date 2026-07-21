import {
  assert,
  fsp,
  path,
  runInTemp,
  runSprinkleRefCli,
  test,
  writeLocalValues,
} from "./aws-account-local-sprinkleref.helpers";

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

test("sprinkleref --init-local writes project local config from workspace root", async () => {
  await runInTemp("sprinkleref-init-local-subdir", async (tmp) => {
    const cwd = process.cwd();
    const projectsDir = path.join(tmp, "projects");
    await fsp.mkdir(projectsDir, { recursive: true });
    process.chdir(projectsDir);
    try {
      const out: string[] = [];
      await runSprinkleRefCli({ argv: ["--init-local"], stdout: (text) => out.push(text) });
      await fsp.access(path.join(tmp, "projects/config/local.json"));
      await assert.rejects(
        fsp.access(path.join(tmp, "projects/projects/config/local.json")),
        /ENOENT/,
      );
      assert.match(out[0] || "", /projects\/config\/local\.json/);
      assert.doesNotMatch(out[0] || "", /projects\/projects\/config\/local\.json/);
    } finally {
      process.chdir(cwd);
    }
  });
});
