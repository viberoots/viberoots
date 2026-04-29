#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";

test("shared-host identity provider module bootstraps generated identity imports", async () => {
  const modulePath = path.join(
    process.cwd(),
    "build-tools",
    "tools",
    "nix",
    "shared-host-identity-provider-module.nix",
  );
  const moduleText = await fsp.readFile(modulePath, "utf8");
  assert.match(moduleText, /generatedImportRoot/);
  assert.match(moduleText, /generatedRealmFile/);
  assert.match(moduleText, /generatedMembershipFile/);
  assert.match(moduleText, /bootstrapFirstOperatorPasswordFile/);
  assert.match(moduleText, /L\+ \$\{generatedImportDir\}\/\$\{generatedRealmImportName\}/);
  assert.match(moduleText, /L\+ \$\{generatedImportDir\}\/\$\{generatedMembershipImportName\}/);
  assert.match(moduleText, /systemd\.services\.keycloak\.preStart/);
  assert.match(moduleText, /systemd\.services\.keycloak\.postStart/);
  await runInTemp("shared-host-identity-provider-generated-imports-eval", async (tmp, $) => {
    const expr = `
      let
        system = import <nixpkgs/nixos> {
          configuration = {
            imports = [ ./build-tools/tools/nix/shared-host-identity-provider-module.nix ];
            system.stateVersion = "24.11";
            deploymentHost.identityProvider = {
              enable = true;
              hostname = "identity.example.test";
              acmeEmail = "ops@example.test";
              keycloakHttpPort = 8091;
              generatedImportRoot = "/srv/common/deployment-host/identity-provider";
              bootstrapClientRedirectUris = [ "https://deploy-auth.example.test/oidc/callback" ];
              bootstrapFirstOperatorEmail = "ops@example.test";
              bootstrapFirstOperatorPasswordFile = "/var/lib/deployment-host-secrets/bootstrap-first-operator-password";
              bootstrapTokenClaims = {
                deployment_environment = "mini";
                repository = "kiltyj/bucknix-fresh";
              };
              manageNginx = true;
              manageAcme = true;
              openFirewall = true;
            };
          };
        };
        host = system.config.deploymentHost.identityProvider.hostname;
        vhost = system.config.services.nginx.virtualHosts.\${host};
      in {
        enabled = system.config.services.keycloak.enable;
        package = system.config.services.keycloak.package.pname;
        hostname = system.config.services.keycloak.settings.hostname;
        httpHost = system.config.services.keycloak.settings.http-host;
        httpPort = system.config.services.keycloak.settings.http-port;
        databaseType = system.config.services.keycloak.database.type;
        passwordFile = system.config.services.keycloak.database.passwordFile;
        initialAdminPassword =
          system.config.services.keycloak.initialAdminPassword or null;
        generatedImportRoot = system.config.deploymentHost.identityProvider.generatedImportRoot;
        generatedRealmFile =
          system.config.deploymentHost.identityProvider.generatedRealmFile or null;
        generatedMembershipFile =
          system.config.deploymentHost.identityProvider.generatedMembershipFile or null;
        bootstrapFirstOperatorPasswordFile =
          system.config.deploymentHost.identityProvider.bootstrapFirstOperatorPasswordFile or null;
        hasBootstrapService =
          builtins.hasAttr "deployment-host-keycloak-generated-import-bootstrap"
          system.config.systemd.services;
        bootstrapScript =
          system.config.systemd.services.deployment-host-keycloak-generated-import-bootstrap.script;
        keycloakPreStart = system.config.systemd.services.keycloak.preStart or "";
        keycloakPostStart = system.config.systemd.services.keycloak.postStart or "";
        nginxEnabled = system.config.services.nginx.enable;
        forceSSL = vhost.forceSSL;
        enableACME = vhost.enableACME;
        proxyPass = vhost.locations."/".proxyPass;
        acmeEmail = system.config.security.acme.defaults.email;
        firewallPorts = system.config.networking.firewall.allowedTCPPorts;
      }
    `;
    const { stdout } = await $({ cwd: tmp })`nix eval --impure --expr ${expr} --json`;
    const out = JSON.parse(String(stdout || "{}")) as {
      enabled: boolean;
      package: string;
      hostname: string;
      httpHost: string;
      httpPort: number;
      databaseType: string;
      passwordFile: string;
      initialAdminPassword: string | null;
      generatedImportRoot: string;
      generatedRealmFile: string | null;
      generatedMembershipFile: string | null;
      bootstrapFirstOperatorPasswordFile: string | null;
      hasBootstrapService: boolean;
      bootstrapScript: string;
      keycloakPreStart: string;
      keycloakPostStart: string;
      nginxEnabled: boolean;
      forceSSL: boolean;
      enableACME: boolean;
      proxyPass: string;
      acmeEmail: string;
      firewallPorts: number[];
    };
    assert.equal(out.enabled, true);
    assert.equal(out.package, "keycloak");
    assert.equal(out.hostname, "https://identity.example.test");
    assert.equal(out.httpHost, "127.0.0.1");
    assert.equal(out.httpPort, 8091);
    assert.equal(out.databaseType, "postgresql");
    assert.equal(out.passwordFile, "/var/lib/deployment-host-secrets/keycloak-db-password");
    assert.equal(out.initialAdminPassword, null);
    assert.equal(out.generatedImportRoot, "/srv/common/deployment-host/identity-provider");
    assert.equal(out.generatedRealmFile, null);
    assert.equal(out.generatedMembershipFile, null);
    assert.equal(
      out.bootstrapFirstOperatorPasswordFile,
      "/var/lib/deployment-host-secrets/bootstrap-first-operator-password",
    );
    assert.equal(out.hasBootstrapService, true);
    assert.match(out.bootstrapScript, /deployment-cli/);
    assert.match(out.bootstrapScript, /"claim\.name":"email"/);
    assert.match(out.bootstrapScript, /oidc-audience-mapper/);
    assert.match(out.bootstrapScript, /"included\.custom\.audience":"deployments-vault"/);
    assert.match(out.bootstrapScript, /oidc-hardcoded-claim-mapper/);
    assert.match(out.bootstrapScript, /"claim\.name":"deployment_environment"/);
    assert.match(out.bootstrapScript, /"claim\.value":"mini"/);
    assert.match(out.bootstrapScript, /"claim\.name":"repository"/);
    assert.match(out.bootstrapScript, /"claim\.value":"kiltyj\/bucknix-fresh"/);
    assert.match(out.bootstrapScript, /generated_realm_tmp="\$\(mktemp\)"/);
    assert.match(out.bootstrapScript, /cmp -s "\$generated_realm_tmp"/);
    assert.match(out.bootstrapScript, /install -m 0644 "\$generated_realm_tmp"/);
    assert.match(out.bootstrapScript, /deploy-admin-identity-shape-admin-global/);
    assert.match(out.bootstrapScript, /ops@example\.test/);
    assert.match(out.keycloakPreStart, /kc\.sh bootstrap-admin service/);
    assert.match(out.keycloakPreStart, /deployment-host-bootstrap-admin/);
    assert.match(out.keycloakPreStart, /temporary recovery admin/i);
    assert.match(out.keycloakPreStart, /bootstrap_runtime_dir="\$\(mktemp -d\)"/);
    assert.match(out.keycloakPreStart, /KC_HOME_DIR="\$bootstrap_runtime_dir"/);
    assert.match(out.keycloakPreStart, /KC_CONF_DIR="\$bootstrap_runtime_dir\/conf"/);
    assert.match(out.keycloakPreStart, /ln -s .*keycloak-.*\/providers/);
    assert.match(out.keycloakPreStart, /ln -s .*keycloak-.*\/lib/);
    assert.doesNotMatch(out.keycloakPreStart, /bootstrap-admin service[\s\S]*--optimized/);
    assert.match(out.keycloakPreStart, /printf 'db=%s\\n' postgres/);
    assert.match(out.keycloakPreStart, /printf 'db-username=%s\\n' keycloak/);
    assert.match(out.keycloakPreStart, /printf 'db-password=%s\\n' "\$db_password"/);
    assert.match(
      out.keycloakPreStart,
      /printf 'db-url(?:-host|-database|-port|-properties)?=%s\\n'/,
    );
    assert.doesNotMatch(out.keycloakPreStart, /(^|[[:space:]])--db([[:space:]]|$)/);
    assert.match(out.keycloakPreStart, /--client-secret:env=BNX_KEYCLOAK_BOOTSTRAP_ADMIN_SECRET/);
    assert.match(out.keycloakPostStart, /kcadm\.sh create realms/);
    assert.match(out.keycloakPostStart, /kcadm\.sh create groups/);
    assert.match(out.keycloakPostStart, /del\(\.groups\)/);
    assert.match(out.keycloakPostStart, /kcadm\.sh create partialImport/);
    assert.match(out.keycloakPostStart, /realms\/master\/\.well-known\/openid-configuration/);
    assert.match(out.keycloakPostStart, /local Keycloak endpoint did not become ready/);
    assert.match(out.keycloakPostStart, /ifResourceExists=OVERWRITE/);
    assert.match(out.keycloakPostStart, /desired-client\.json/);
    assert.match(out.keycloakPostStart, /kcadm\.sh update "clients\/\$live_client_id"/);
    assert.match(out.keycloakPostStart, /protocol-mappers\/models/);
    assert.match(out.keycloakPostStart, /bootstrap identity migration failed while reconciling/);
    assert.match(out.keycloakPostStart, /live bootstrap realm shape/);
    assert.match(out.keycloakPostStart, /desired-user\.json/);
    assert.match(out.keycloakPostStart, /kcadm\.sh update "users\/\$live_user_id"/);
    assert.match(out.keycloakPostStart, /users\/\$live_user_id\/groups\/\$group_id/);
    assert.match(out.keycloakPostStart, /first-operator bootstrap membership binding/);
    assert.match(out.keycloakPostStart, /first-operator password bootstrap/);
    assert.match(out.keycloakPostStart, /first-operator temporary password/);
    assert.match(out.keycloakPostStart, /first-operator-password-set-v1/);
    assert.match(
      out.keycloakPostStart,
      /\/var\/lib\/deployment-host-secrets\/bootstrap-first-operator-password/,
    );
    assert.match(out.keycloakPostStart, /kcadm\.sh set-password/);
    assert.match(out.keycloakPostStart, /--username ops@example\.test/);
    assert.match(out.keycloakPostStart, /--new-password "\$first_operator_password"/);
    assert.match(out.keycloakPostStart, /--temporary/);
    assert.match(out.keycloakPostStart, /kcadm\.sh delete "clients\/\$client_id"/);
    assert.equal(out.nginxEnabled, true);
    assert.equal(out.forceSSL, true);
    assert.equal(out.enableACME, true);
    assert.equal(out.proxyPass, "http://127.0.0.1:8091");
    assert.equal(out.acmeEmail, "ops@example.test");
    assert.deepEqual(out.firewallPorts, [80, 443]);
  });
});
