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

  reconcileClientsStep = filePath: label: ''
    if [ -f ${escape filePath} ]; then
      while IFS= read -r client_blob; do
        if [ -z "$client_blob" ]; then
          continue
        fi
        desired_client_file="$kcadm_dir/desired-client.json"
        desired_client_update_file="$kcadm_dir/desired-client-update.json"
        desired_mapper_file="$kcadm_dir/desired-client-mapper.json"
        printf '%s' "$client_blob" | ${pkgs.coreutils}/bin/base64 --decode >"$desired_client_file"
        desired_client_id="$(${pkgs.jq}/bin/jq -r '.clientId // empty' "$desired_client_file")"
        if [ -z "$desired_client_id" ]; then
          echo "bootstrap identity migration failed while reconciling ${label}: clientId is missing" >&2
          exit 1
        fi
        live_client_id="$(
          ${keycloakBin}/kcadm.sh get clients \
            --config "$kcadm_config" \
            -r deployments \
            -q clientId="$desired_client_id" \
            | ${pkgs.jq}/bin/jq -r '.[0].id // empty'
        )"
        if [ -z "$live_client_id" ]; then
          if ! ${keycloakBin}/kcadm.sh create clients \
            --config "$kcadm_config" \
            -r deployments \
            -f "$desired_client_file" >/dev/null; then
            echo "bootstrap identity migration failed while creating ${label} client $desired_client_id" >&2
            exit 1
          fi
          live_client_id="$(
            ${keycloakBin}/kcadm.sh get clients \
              --config "$kcadm_config" \
              -r deployments \
              -q clientId="$desired_client_id" \
              | ${pkgs.jq}/bin/jq -r '.[0].id // empty'
          )"
        else
          ${pkgs.jq}/bin/jq 'del(.protocolMappers)' "$desired_client_file" >"$desired_client_update_file"
          if ! ${keycloakBin}/kcadm.sh update "clients/$live_client_id" \
            --config "$kcadm_config" \
            -r deployments \
            -f "$desired_client_update_file" >/dev/null; then
            echo "bootstrap identity migration failed while updating ${label} client $desired_client_id" >&2
            exit 1
          fi
        fi
        if [ -z "$live_client_id" ]; then
          echo "bootstrap identity migration failed while resolving ${label} client $desired_client_id" >&2
          exit 1
        fi
        ${keycloakBin}/kcadm.sh get "clients/$live_client_id/protocol-mappers/models" \
          --config "$kcadm_config" \
          -r deployments \
          | ${pkgs.jq}/bin/jq -r '.[]?.id // empty' \
          | while IFS= read -r mapper_id; do
            if [ -n "$mapper_id" ]; then
              ${keycloakBin}/kcadm.sh delete "clients/$live_client_id/protocol-mappers/models/$mapper_id" \
                --config "$kcadm_config" \
                -r deployments >/dev/null
            fi
          done
        while IFS= read -r mapper_json; do
          if [ -z "$mapper_json" ]; then
            continue
          fi
          printf '%s\n' "$mapper_json" >"$desired_mapper_file"
          if ! ${keycloakBin}/kcadm.sh create "clients/$live_client_id/protocol-mappers/models" \
            --config "$kcadm_config" \
            -r deployments \
            -f "$desired_mapper_file" >/dev/null; then
            echo "bootstrap identity migration failed while reconciling ${label} mapper for client $desired_client_id" >&2
            exit 1
          fi
        done < <(${pkgs.jq}/bin/jq -c '.protocolMappers[]?' "$desired_client_file")
      done < <(${pkgs.jq}/bin/jq -r '.clients[]? | @base64' ${escape filePath})
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
