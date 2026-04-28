{
  lib,
  config,
  pkgs,
  generatedImportRoot,
  generatedRealmFile,
  generatedMembershipFile,
  generatedRealmBootstrapJson,
  generatedMembershipBootstrapJson,
}:
let
  keycloak = config.services.keycloak;
  database = keycloak.database;
  keycloakBin = "${keycloak.package}/bin";
  escape = lib.escapeShellArg;
  bootstrapAdminClientId = "deployment-host-bootstrap-admin";
  bootstrapAdminSecretFile =
    "${generatedImportRoot}/.deployment-host-keycloak-bootstrap-admin-secret";
  bootstrapAdminMarkerFile =
    "${generatedImportRoot}/.deployment-host-keycloak-bootstrap-admin-created";
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
    db_args=(
      --db-username ${escape databaseUser}
    )
    ${lib.optionalString (database.passwordFile != null) ''
      db_password="$(<${escape (toString database.passwordFile)})"
      db_args+=(--db-password "$db_password")
    ''}
    ${if lib.hasPrefix "/" database.host then
      ''
        db_args+=(--db-url ${escape unixSocketUrl})
      ''
    else
      ''
        db_args+=(
          --db-url-host ${escape database.host}
          --db-url-port ${escape (toString database.port)}
          --db-url-database ${escape databaseName}
        )
        ${lib.optionalString (databasePropsArg != null) ''
          db_args+=(--db-url-properties ${escape databasePropsArg})
        ''}
      ''}
  '';
  localServerUrl =
    "http://${keycloak.settings.http-host or "127.0.0.1"}:${toString (keycloak.settings.http-port or 8080)}";
  partialImportStep = filePath: label: ''
    if [ -f ${escape filePath} ]; then
      if ! ${keycloakBin}/kcadm.sh create partialImport \
        --config "$kcadm_config" \
        -r deployments \
        -s ifResourceExists=OVERWRITE \
        -o \
        -f ${escape filePath} >/dev/null; then
        echo "bootstrap identity migration failed while reconciling ${label}" >&2
        exit 1
      fi
    fi
  '';
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
    if ! ${keycloakBin}/kc.sh bootstrap-admin service \
      --optimized \
      "''${db_args[@]}" \
      --client-id ${escape bootstrapAdminClientId} \
      --client-secret:env BNX_KEYCLOAK_BOOTSTRAP_ADMIN_SECRET \
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
    if ! ${keycloakBin}/kcadm.sh config credentials \
      --config "$kcadm_config" \
      --server ${escape localServerUrl} \
      --realm master \
      --client ${escape bootstrapAdminClientId} \
      --secret "$secret" >/dev/null; then
      echo "bootstrap identity migration failed before live reconciliation: temporary recovery admin login was rejected" >&2
      exit 1
    fi
${partialImportStep generatedRealmFile "the live bootstrap realm shape"}
${partialImportStep generatedMembershipFile "the first-operator bootstrap membership binding"}
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
