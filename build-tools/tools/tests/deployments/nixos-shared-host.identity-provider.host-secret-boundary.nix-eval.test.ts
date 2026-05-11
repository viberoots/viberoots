#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("identity-provider migration reads restricted host secrets through startup boundary", async () => {
  const modulePath = path.join(
    process.cwd(),
    "build-tools",
    "tools",
    "nix",
    "shared-host-identity-provider-module.nix",
  );
  const moduleText = await fsp.readFile(modulePath, "utf8");
  assert.match(moduleText, /PermissionsStartOnly = true/);
  assert.doesNotMatch(moduleText, /chmod.*keycloak-db-password/);
  assert.doesNotMatch(moduleText, /chgrp.*keycloak-db-password/);
  await runInTemp("identity-provider-host-secret-boundary-eval", async (tmp, $) => {
    const home = path.join(tmp, ".home");
    const cache = path.join(tmp, ".cache");
    await Promise.all([fsp.mkdir(home), fsp.mkdir(cache)]);
    const expr = `
      let
        system = import <nixpkgs/nixos> {
          configuration = {
            imports = [ ./build-tools/tools/nix/shared-host-identity-provider-module.nix ];
            system.stateVersion = "24.11";
            deploymentHost.identityProvider = {
              enable = true;
              hostname = "identity.example.test";
              keycloakHttpPort = 8091;
              databasePasswordFile = "/run/secrets/keycloak-db-password";
              bootstrapClientRedirectUris = [ "https://deploy-auth.example.test/oidc/callback" ];
              bootstrapFirstOperatorEmail = "ops@example.test";
              bootstrapFirstOperatorPasswordFile = "/run/secrets/bootstrap-first-operator-password";
            };
          };
        };
        service = system.config.systemd.services.keycloak;
        serviceConfig = service.serviceConfig;
      in {
        passwordFile = system.config.services.keycloak.database.passwordFile;
        bootstrapFirstOperatorPasswordFile =
          system.config.deploymentHost.identityProvider.bootstrapFirstOperatorPasswordFile or null;
        permissionsStartOnly = serviceConfig.PermissionsStartOnly or false;
        runtimeUser = serviceConfig.User or null;
        dynamicUser = serviceConfig.DynamicUser or false;
        preStart = service.preStart or "";
        postStart = service.postStart or "";
      }
    `;
    const { stdout } = await $({
      cwd: tmp,
      env: { ...process.env, HOME: home, XDG_CACHE_HOME: cache },
    })`nix eval --impure --expr ${expr} --json`;
    const out = JSON.parse(String(stdout || "{}")) as {
      passwordFile: string;
      bootstrapFirstOperatorPasswordFile: string | null;
      permissionsStartOnly: boolean;
      runtimeUser: string | null;
      dynamicUser: boolean;
      preStart: string;
      postStart: string;
    };
    assert.equal(out.passwordFile, "/run/secrets/keycloak-db-password");
    assert.equal(
      out.bootstrapFirstOperatorPasswordFile,
      "/run/secrets/bootstrap-first-operator-password",
    );
    assert.equal(out.permissionsStartOnly, true);
    assert.ok(out.dynamicUser || (out.runtimeUser !== null && out.runtimeUser !== "root"));
    assert.match(out.preStart, /<\$?\{?['"]?\/run\/secrets\/keycloak-db-password/);
    assert.match(out.preStart, /set -o errexit/);
    assert.match(out.preStart, /bootstrap_runtime_dir="\$\(mktemp -d\)"/);
    assert.match(out.preStart, /KC_HOME_DIR="\$bootstrap_runtime_dir"/);
    assert.match(out.preStart, /KC_CONF_DIR="\$bootstrap_runtime_dir\/conf"/);
    assert.match(out.preStart, /ln -s .*keycloak-.*\/providers/);
    assert.match(out.preStart, /ln -s .*keycloak-.*\/lib/);
    assert.doesNotMatch(out.preStart, /bootstrap-admin service[\s\S]*--optimized/);
    assert.match(out.preStart, /printf 'db=%s\\n' postgres/);
    assert.match(out.preStart, /printf 'db-username=%s\\n' keycloak/);
    assert.match(out.preStart, /printf 'db-password=%s\\n' "\$db_password"/);
    assert.match(out.preStart, /printf 'db-url(?:-host|-database|-port|-properties)?=%s\\n'/);
    assert.doesNotMatch(out.preStart, /(^|[[:space:]])--db([[:space:]]|$)/);
    assert.match(out.preStart, /--client-secret:env=VBR_KEYCLOAK_BOOTSTRAP_ADMIN_SECRET/);
    assert.match(out.postStart, /\/run\/secrets\/bootstrap-first-operator-password/);
    assert.match(out.postStart, /first_operator_password="\$\(tr -d '\\n'/);
    assert.match(out.postStart, /--new-password "\$first_operator_password"/);
    assert.doesNotMatch(out.preStart, /chmod|chgrp|sudo/);
    assert.doesNotMatch(out.postStart, /chmod|chgrp|sudo/);
  });
});

test("identity-provider docs use portable host secret reconciliation guidance", async () => {
  const docs = await Promise.all(
    ["docs/nixos-shared-host-setup.md", "docs/vault-production-bootstrap.md"].map(
      async (doc) => await fsp.readFile(path.join(process.cwd(), doc), "utf8"),
    ),
  );
  const combined = docs.join("\n");
  assert.doesNotMatch(combined, /\bpull-switch\b/);
  assert.match(combined, /nixos-rebuild switch --flake/);
  assert.match(combined, /host-managed secret/);
  assert.match(combined, /SprinkleRef/);
});
