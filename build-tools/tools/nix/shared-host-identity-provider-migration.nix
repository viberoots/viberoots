{
  lib,
  config,
  pkgs,
  generatedImportRoot,
  generatedRealmFile,
  generatedMembershipFile,
  generatedRealmBootstrapJson,
  generatedMembershipBootstrapJson,
  bootstrapFirstOperatorEmail ? null,
  bootstrapFirstOperatorPasswordFile ? null,
}:
let
  keycloak = config.services.keycloak;
  database = keycloak.database;
  bootstrapKeycloakBuild = keycloak.package.override {
    plugins =
      keycloak.package.enabledPlugins
      ++ keycloak.plugins
      ++ (with keycloak.package.plugins; [
        quarkus-systemd-notify
        quarkus-systemd-notify-deployment
      ]);
  };
  keycloakHome = toString bootstrapKeycloakBuild;
  keycloakBin = "${bootstrapKeycloakBuild}/bin";
  escape = lib.escapeShellArg;
  bootstrapAdminClientId = "deployment-host-bootstrap-admin";
  bootstrapAdminSecretFile =
    "${generatedImportRoot}/.deployment-host-keycloak-bootstrap-admin-secret";
  bootstrapAdminMarkerFile =
    "${generatedImportRoot}/.deployment-host-keycloak-bootstrap-admin-created-v2";
  steps = import ./shared-host-identity-provider-migration-steps.nix {
    inherit
      lib
      pkgs
      keycloakBin
      escape
      generatedImportRoot
      bootstrapFirstOperatorEmail
      bootstrapFirstOperatorPasswordFile
      ;
  };
  databaseVendor = if database.type == "postgresql" then "postgres" else database.type;
  databaseName =
    if database.createLocally && database.host == "localhost" then "keycloak" else database.name;
  databaseUser =
    if database.createLocally && database.host == "localhost" then "keycloak" else database.username;
  databaseProps =
    if database.type == "postgresql" then
      lib.concatStringsSep "&" (
        lib.optionals database.useSSL [ "ssl=true" ]
        ++ lib.optionals (database.caCert != null) [
          "sslrootcert=${toString database.caCert}"
          "sslmode=verify-ca"
        ]
      )
    else
      lib.concatStringsSep "&" (
        [ "characterEncoding=UTF-8" ]
        ++ lib.optionals database.useSSL [
          "useSSL=true"
          "requireSSL=true"
          "verifyServerCertificate=true"
        ]
        ++ lib.optionals (database.caCert != null) [
          "trustCertificateKeyStoreUrl=file:${toString database.caCert}"
          "trustCertificateKeyStorePassword=notsosecretpassword"
        ]
      );
  databasePropsArg = if databaseProps == "" then null else "?${databaseProps}";
  unixSocketUrl =
    "jdbc:postgresql://localhost/${databaseName}?socketFactory=org.newsclub.net.unix.AFUNIXSocketFactory$FactoryArg&socketFactoryArg=${database.host}/.s.PGSQL.${toString database.port}&sslMode=disable";
  strictShell = ''
    set -o errexit -o pipefail -o nounset -o errtrace
    shopt -s inherit_errexit
  '';
  databaseArgsScript = ''
    ${lib.optionalString (database.passwordFile != null) ''
      db_password="$(<${escape (toString database.passwordFile)})"
    ''}
  '';
  databaseConfigScript = ''
    {
      printf 'db=%s\n' ${escape databaseVendor}
      printf 'db-username=%s\n' ${escape databaseUser}
      ${lib.optionalString (database.passwordFile != null) ''
        printf 'db-password=%s\n' "$db_password"
      ''}
    ${if lib.hasPrefix "/" database.host then
      ''
      printf 'db-url=%s\n' ${escape unixSocketUrl}
      ''
    else
      ''
      printf 'db-url-host=%s\n' ${escape database.host}
      printf 'db-url-port=%s\n' ${escape (toString database.port)}
      printf 'db-url-database=%s\n' ${escape databaseName}
      ${lib.optionalString (databasePropsArg != null) ''
        printf 'db-url-properties=%s\n' ${escape databasePropsArg}
      ''}
      ''}
    } >"$bootstrap_runtime_dir/conf/keycloak.conf"
  '';
  localServerUrl =
    "http://${keycloak.settings.http-host or "127.0.0.1"}:${toString (keycloak.settings.http-port or 8080)}";
  localReadyUrl = "${localServerUrl}/realms/master/.well-known/openid-configuration";
in
{
  inherit bootstrapAdminClientId;

  bootstrapManagedFilesScript = ''
    ${strictShell}
    install -d -m 0755 ${escape generatedImportRoot}
    ${lib.optionalString (generatedRealmFile != null) ''
      if [ ! -f ${escape generatedRealmFile} ]; then
        cat >${escape generatedRealmFile} <<'EOF'
${generatedRealmBootstrapJson}
EOF
      fi
    ''}
    ${lib.optionalString (generatedMembershipFile != null) ''
      if [ ! -f ${escape generatedMembershipFile} ]; then
        cat >${escape generatedMembershipFile} <<'EOF'
${generatedMembershipBootstrapJson}
EOF
      fi
    ''}
  '';

  bootstrapAdminPreStart = ''
    ${strictShell}
    if [ ! -f ${escape generatedRealmFile} ] && [ ! -f ${escape generatedMembershipFile} ]; then
      exit 0
    fi
    ${databaseArgsScript}
    install -d -m 0700 ${escape generatedImportRoot}
    if [ ! -s ${escape bootstrapAdminSecretFile} ]; then
      umask 077
      ${pkgs.openssl}/bin/openssl rand -hex 32 >${escape bootstrapAdminSecretFile}
    fi
    if [ -f ${escape bootstrapAdminMarkerFile} ]; then
      exit 0
    fi
    export BNX_KEYCLOAK_BOOTSTRAP_ADMIN_SECRET="$(tr -d '\n' < ${escape bootstrapAdminSecretFile})"
    bootstrap_runtime_dir="$(mktemp -d)"
    trap 'rm -rf "$bootstrap_runtime_dir"' EXIT
    install -d -m 0700 "$bootstrap_runtime_dir/conf"
    ${databaseConfigScript}
    ln -s ${escape keycloakHome}/providers "$bootstrap_runtime_dir/providers"
    ln -s ${escape keycloakHome}/lib "$bootstrap_runtime_dir/lib"
    if ! KC_HOME_DIR="$bootstrap_runtime_dir" KC_CONF_DIR="$bootstrap_runtime_dir/conf" \
      ${keycloakBin}/kc.sh bootstrap-admin service \
      --client-id ${escape bootstrapAdminClientId} \
      --client-secret:env=BNX_KEYCLOAK_BOOTSTRAP_ADMIN_SECRET \
      --no-prompt; then
      echo "bootstrap identity migration failed while creating the temporary recovery admin" >&2
      exit 1
    fi
    touch ${escape bootstrapAdminMarkerFile}
  '';

  bootstrapRealmMigrationPostStart = ''
    ${strictShell}
    if [ ! -f ${escape generatedRealmFile} ] && [ ! -f ${escape generatedMembershipFile} ]; then
      exit 0
    fi
    if [ ! -s ${escape bootstrapAdminSecretFile} ]; then
      echo "bootstrap identity migration failed before live reconciliation: temporary recovery admin secret is missing" >&2
      exit 1
    fi
    kcadm_dir="$(mktemp -d)"
    kcadm_config="$kcadm_dir/kcadm.config"
    trap 'rm -rf "$kcadm_dir"' EXIT
    secret="$(tr -d '\n' < ${escape bootstrapAdminSecretFile})"
    keycloak_ready=0
    for _attempt in {1..60}; do
      if ${pkgs.curl}/bin/curl --fail --silent --max-time 2 ${escape localReadyUrl} >/dev/null; then
        keycloak_ready=1
        break
      fi
      sleep 1
    done
    if [ "$keycloak_ready" != "1" ]; then
      echo "bootstrap identity migration failed before live reconciliation: local Keycloak endpoint did not become ready" >&2
      exit 1
    fi
    if ! ${keycloakBin}/kcadm.sh config credentials \
      --config "$kcadm_config" \
      --server ${escape localServerUrl} \
      --realm master \
      --client ${escape bootstrapAdminClientId} \
      --secret "$secret" >/dev/null; then
      echo "bootstrap identity migration failed before live reconciliation: temporary recovery admin login was rejected" >&2
      exit 1
    fi
${steps.ensureDeploymentsRealmStep}
${steps.reconcileGroupsStep generatedRealmFile "the live bootstrap realm shape"}
${steps.partialImportStep generatedRealmFile "the live bootstrap realm shape"}
${steps.reconcileClientsStep generatedRealmFile "the live bootstrap realm shape"}
${steps.partialImportStep generatedMembershipFile "the first-operator bootstrap membership binding"}
${steps.bootstrapFirstOperatorPasswordStep}
    client_id="$(
      ${keycloakBin}/kcadm.sh get clients \
        --config "$kcadm_config" \
        -r master \
        -q clientId=${escape bootstrapAdminClientId} \
        | ${pkgs.jq}/bin/jq -r '.[0].id // empty'
    )"
    if [ -n "$client_id" ]; then
      if ! ${keycloakBin}/kcadm.sh delete "clients/$client_id" --config "$kcadm_config" -r master; then
        echo "bootstrap identity migration failed while cleaning up the temporary recovery admin" >&2
        exit 1
      fi
    fi
    rm -f ${escape bootstrapAdminSecretFile} ${escape bootstrapAdminMarkerFile}
  '';
}
