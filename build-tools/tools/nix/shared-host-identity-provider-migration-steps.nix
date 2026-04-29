{
  lib,
  pkgs,
  keycloakBin,
  escape,
  generatedImportRoot,
  bootstrapFirstOperatorEmail ? null,
  bootstrapFirstOperatorPasswordFile ? null,
}:
let
  bootstrapFirstOperatorPasswordMarkerFile =
    "${generatedImportRoot}/.deployment-host-keycloak-first-operator-password-set-v1";
  normalizedBootstrapFirstOperatorEmail =
    if bootstrapFirstOperatorEmail == null then
      null
    else
      let trimmed = lib.strings.trim bootstrapFirstOperatorEmail; in
      if trimmed == "" then null else lib.strings.toLower trimmed;
in
{
  ensureDeploymentsRealmStep = ''
    if ! ${keycloakBin}/kcadm.sh get realms/deployments --config "$kcadm_config" >/dev/null 2>&1; then
      if ! ${keycloakBin}/kcadm.sh create realms \
        --config "$kcadm_config" \
        -s realm=deployments \
        -s enabled=true >/dev/null; then
        echo "bootstrap identity migration failed while creating the deployments realm" >&2
        exit 1
      fi
    fi
  '';

  reconcileGroupsStep = filePath: label: ''
    if [ -f ${escape filePath} ]; then
      while IFS= read -r group_name; do
        if [ -z "$group_name" ]; then
          continue
        fi
        if ${keycloakBin}/kcadm.sh get groups \
          --config "$kcadm_config" \
          -r deployments \
          -q search="$group_name" \
          | ${pkgs.jq}/bin/jq -e --arg name "$group_name" 'any(.[]?; .name == $name)' >/dev/null; then
          continue
        fi
        if ! ${keycloakBin}/kcadm.sh create groups \
          --config "$kcadm_config" \
          -r deployments \
          -s name="$group_name" >/dev/null; then
          echo "bootstrap identity migration failed while reconciling ${label} group $group_name" >&2
          exit 1
        fi
      done < <(${pkgs.jq}/bin/jq -r '.groups[]?.name // empty' ${escape filePath})
    fi
  '';

  partialImportStep = filePath: label: ''
    if [ -f ${escape filePath} ]; then
      partial_import_file=${escape filePath}
      if ${pkgs.jq}/bin/jq -e 'has("groups")' ${escape filePath} >/dev/null; then
        partial_import_file="$kcadm_dir/$(basename ${escape filePath}).without-groups.json"
        ${pkgs.jq}/bin/jq 'del(.groups)' ${escape filePath} >"$partial_import_file"
      fi
      if ! ${keycloakBin}/kcadm.sh create partialImport \
        --config "$kcadm_config" \
        -r deployments \
        -s ifResourceExists=OVERWRITE \
        -o \
        -f "$partial_import_file" >/dev/null; then
        echo "bootstrap identity migration failed while reconciling ${label}" >&2
        exit 1
      fi
    fi
  '';

  bootstrapFirstOperatorPasswordStep =
    lib.optionalString
      (normalizedBootstrapFirstOperatorEmail != null && bootstrapFirstOperatorPasswordFile != null)
      ''
        if [ ! -f ${escape bootstrapFirstOperatorPasswordMarkerFile} ]; then
          if [ ! -s ${escape bootstrapFirstOperatorPasswordFile} ]; then
            echo "bootstrap identity migration failed before first-operator password bootstrap: configured password file is missing or empty" >&2
            exit 1
          fi
          first_operator_password="$(tr -d '\n' < ${escape bootstrapFirstOperatorPasswordFile})"
          if [ -z "$first_operator_password" ]; then
            echo "bootstrap identity migration failed before first-operator password bootstrap: configured password file is empty" >&2
            exit 1
          fi
          if ! ${keycloakBin}/kcadm.sh set-password \
            --config "$kcadm_config" \
            -r deployments \
            --username ${escape normalizedBootstrapFirstOperatorEmail} \
            --new-password "$first_operator_password" \
            --temporary >/dev/null; then
            echo "bootstrap identity migration failed while setting the first-operator temporary password" >&2
            exit 1
          fi
          touch ${escape bootstrapFirstOperatorPasswordMarkerFile}
        fi
      '';
}
