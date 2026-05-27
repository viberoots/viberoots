{ lib, config, ... }:
let
  defaults = import ./deployment-control-plane-container-defaults.nix;
  cfg = config.services.viberoots.deploymentControlPlaneContainer;
  opt = type: default: description: lib.mkOption { inherit type default description; };
  nullStr = lib.types.nullOr lib.types.str;
  configFile = defaults.configFile;
  configEtcName = lib.removePrefix "/etc/" configFile;
  imageRef =
    if cfg.image != null then cfg.image
    else if cfg.imageRegistry == null || cfg.imageRepository == null || cfg.imageDigest == null then ""
    else "${cfg.imageRegistry}/${cfg.imageRepository}@${cfg.imageDigest}";
  digestPattern = "sha256:[0-9a-f]{64}";
  imageRefPattern = ".+@${digestPattern}";
  imageRefDigestMatch = builtins.match ".*@(${digestPattern})" imageRef;
  resolvedImageDigest =
    if cfg.imageDigest != null then cfg.imageDigest
    else if imageRefDigestMatch == null then null
    else builtins.elemAt imageRefDigestMatch 0;
  credentialSource = name:
    if builtins.hasAttr name cfg.credentials then cfg.credentials.${name}.source else cfg.extraCredentialFiles.${name};
  configuredCredentialNames = lib.unique (builtins.attrNames cfg.credentials ++ builtins.attrNames cfg.extraCredentialFiles);
  reviewedSourceCredentialNames =
    if cfg.reviewedSourceMode == "github-app" then [
      cfg.reviewedSourceGithubAppIdCredential
      cfg.reviewedSourceGithubAppInstallationIdCredential
      cfg.reviewedSourceGithubAppPrivateKeyCredential
    ] else [
      cfg.reviewedSourceSshKeyCredential
      cfg.reviewedSourceKnownHostsCredential
    ];
  credentialNames = lib.unique (
    [
      cfg.databaseUrlCredential
      cfg.controlPlaneTokenCredential
      cfg.artifactStore.endpointCredential
      cfg.artifactStore.accessKeyIdCredential
      cfg.artifactStore.secretAccessKeyCredential
    ]
    ++ reviewedSourceCredentialNames
    ++ configuredCredentialNames
  );
  loadCredentials = map (name: "${name}:${credentialSource name}") credentialNames;
  requiredCredentialNames = [
    cfg.databaseUrlCredential
    cfg.controlPlaneTokenCredential
    cfg.artifactStore.endpointCredential
    cfg.artifactStore.accessKeyIdCredential
    cfg.artifactStore.secretAccessKeyCredential
  ] ++ reviewedSourceCredentialNames ++ infisicalCredentialNames;
  infisicalCredentialNames = lib.flatten (
    map
      (deploymentId: [
        (deploymentCredentialName cfg.infisicalCredentialFilePattern.clientId deploymentId)
        (deploymentCredentialName cfg.infisicalCredentialFilePattern.clientSecret deploymentId)
      ])
      cfg.infisicalDeploymentIds
  );
  deploymentCredentialName = pattern: deploymentId:
    lib.replaceStrings [ "{deploymentId}" ] [ deploymentId ] pattern;
  missingCredentialNames = lib.filter
    (name: !(builtins.hasAttr name cfg.credentials) && !(builtins.hasAttr name cfg.extraCredentialFiles))
    requiredCredentialNames;
  nullCredentialNames = lib.filter (name: credentialSource name == null) configuredCredentialNames;
  credentialFile = name: "${cfg.credentialDirectory}/${name}";
  credentialRuntimeRoot = "/run/deployment-control-plane-container-credentials";
  credentialRuntimeDirectory = name: "${credentialRuntimeRoot}/${name}";
  credentialStageScript = name: ''
    set -euo pipefail
    dst=${credentialRuntimeDirectory name}
    rm -rf "$dst"
    install -d -m 0500 -o ${defaults.containerUid} -g ${defaults.containerGid} "$dst"
    ${lib.concatMapStringsSep "\n" (credentialName: ''
      install -m 0400 -o ${defaults.containerUid} -g ${defaults.containerGid} "$CREDENTIALS_DIRECTORY/${credentialName}" "$dst/${credentialName}"
    '') credentialNames}
  '';
  renderedConfig = import ./deployment-control-plane-container-config.nix { inherit cfg credentialFile; };
  baseVolumes = [
    "${configFile}:${configFile}:ro"
    "${cfg.recordsRoot}:${defaults.recordsRoot}:rw"
    "${cfg.artifactStagingRoot}:${defaults.artifactStagingRoot}:rw"
    "${cfg.runtimeRoot}:${defaults.runtimeRoot}:rw"
  ];
  containerFor = name: mode: {
    image = imageRef;
    autoStart = true;
    volumes = baseVolumes ++ [ "${credentialRuntimeDirectory name}:${cfg.credentialDirectory}:ro" ];
    environment = lib.optionalAttrs (resolvedImageDigest != null) {
      VBR_CONTROL_PLANE_IMAGE_DIGEST = resolvedImageDigest;
    } // {
      WORKSPACE_ROOT = "${defaults.runtimeRoot}/workspace";
      TMPDIR = "${defaults.runtimeRoot}/tmp";
    };
    cmd = [ mode "--config" configFile ];
  };
  healthCmd =
    "node -e 'fetch(\"http://127.0.0.1:${toString cfg.port}/healthz\")"
    + ".then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'";
  networkExtraOptions = lib.optionals (cfg.networkMode == "host") [ "--network=host" ];
  serviceContainer = containerFor defaults.serviceContainerName "service" // {
    ports = lib.optionals (cfg.networkMode == "bridge") [ "${cfg.bindAddress}:${toString cfg.port}:${toString cfg.port}" ];
    extraOptions = networkExtraOptions ++ [
      "--health-cmd=${healthCmd}"
      "--health-interval=30s"
      "--health-timeout=5s"
      "--health-retries=3"
    ];
  };
  workerIndexes = lib.range 1 cfg.workerReplicas;
  workerNames = map (index: "${defaults.workerContainerNamePrefix}-${toString index}") workerIndexes;
  workerContainers = lib.listToAttrs (
    map (name: lib.nameValuePair name (containerFor name "worker" // { extraOptions = networkExtraOptions; })) workerNames
  );
  allContainerNames = [ defaults.serviceContainerName ] ++ workerNames;
  systemdCredentialServices = lib.listToAttrs (
    map
      (name: lib.nameValuePair "${cfg.containerRuntime}-${name}" {
        serviceConfig.LoadCredential = loadCredentials;
        preStart = credentialStageScript name;
      })
      allContainerNames
  );
in
{
  options.services.viberoots.deploymentControlPlaneContainer = {
    enable = lib.mkEnableOption "containerized deployment control plane";
    instanceId = opt nullStr null "Control-plane instance id.";
    image = opt nullStr null "Complete reviewed image reference.";
    imageRegistry = opt nullStr null "Image registry when image is assembled from parts.";
    imageRepository = opt nullStr null "Image repository when image is assembled from parts.";
    imageDigest = opt nullStr null "Immutable image digest when image is assembled from parts.";
    publicUrl = opt nullStr null "Externally routed service URL.";
    publicHostName = opt nullStr null "Optional hostname for managed nginx.";
    serviceHost = opt lib.types.str "0.0.0.0" "Container service bind host.";
    bindAddress = opt lib.types.str defaults.bindAddress "Host bind address.";
    port = opt lib.types.port defaults.servicePort "Host and container service port.";
    networkMode = opt (lib.types.enum [ "bridge" "host" ]) "bridge" "OCI network mode.";
    containerRuntime = opt (lib.types.enum [ "podman" "docker" ]) defaults.containerRuntime "OCI runtime.";
    workerReplicas = opt lib.types.ints.positive defaults.workerReplicas "Worker container count.";
    webUi.enable = opt lib.types.bool true "Whether the web UI is enabled.";
    webUi.basePath = opt lib.types.str defaults.webUiBasePath "Web UI base path.";
    mcp.enable = opt lib.types.bool true "Whether HTTP MCP is enabled.";
    mcp.basePath = opt lib.types.str defaults.mcpBasePath "HTTP MCP base path.";
    miniMigrationPreflight.enable = opt lib.types.bool false "Require mini database migration cutover evidence before protected/shared submit.";
    recordsRoot = opt lib.types.str defaults.recordsRoot "Host records directory.";
    artifactStagingRoot = opt lib.types.str defaults.artifactStagingRoot "Host artifact scratch directory.";
    runtimeRoot = opt lib.types.str defaults.runtimeRoot "Host runtime scratch directory.";
    credentialDirectory = opt lib.types.str defaults.credentialDirectory "Container credential directory.";
    databaseUrlCredential = opt lib.types.str defaults.databaseUrlCredential "Database credential name.";
    controlPlaneTokenCredential = opt lib.types.str defaults.controlPlaneTokenCredential "Reviewed service bearer token credential name.";
    reviewedSourceMode = opt (lib.types.enum [ "ssh" "github-app" ]) "ssh" "Reviewed-source credential mode.";
    reviewedSourceSshKeyCredential = opt lib.types.str defaults.reviewedSourceSshKeyCredential "SSH key credential name.";
    reviewedSourceKnownHostsCredential = opt lib.types.str defaults.reviewedSourceKnownHostsCredential "SSH known-hosts credential name.";
    reviewedSourceGithubAppIdCredential = opt lib.types.str defaults.reviewedSourceGithubAppIdCredential "GitHub App id credential name.";
    reviewedSourceGithubAppInstallationIdCredential = opt lib.types.str defaults.reviewedSourceGithubAppInstallationIdCredential "GitHub App installation id credential name.";
    reviewedSourceGithubAppPrivateKeyCredential = opt lib.types.str defaults.reviewedSourceGithubAppPrivateKeyCredential "GitHub App private key credential name.";
    artifactStore = {
      kind = opt (lib.types.enum [ "s3-compatible" ]) defaults.artifactStoreKind "Artifact store kind.";
      bucket = opt nullStr null "Artifact store bucket.";
      region = opt lib.types.str defaults.artifactStoreRegion "S3-compatible artifact store signing region.";
      endpointCredential = opt lib.types.str defaults.artifactEndpointCredential "Endpoint credential name.";
      accessKeyIdCredential = opt lib.types.str defaults.artifactAccessKeyIdCredential "Access key credential name.";
      secretAccessKeyCredential = opt lib.types.str defaults.artifactSecretAccessKeyCredential "Secret key credential name.";
    };
    infisicalCredentialFilePattern.clientId = opt lib.types.str defaults.infisicalClientIdPattern "Infisical client id pattern.";
    infisicalCredentialFilePattern.clientSecret = opt lib.types.str defaults.infisicalClientSecretPattern "Infisical client secret pattern.";
    infisicalDeploymentIds = opt (lib.types.listOf lib.types.str) [ "cloud-control-fixture-staging" ] "Deployment ids that require deployment-scoped Infisical credentials.";
    infisicalSiteUrl = opt lib.types.str "https://app.infisical.com" "Infisical site URL for generated runtime credential requirements.";
    infisicalEnvironment = opt lib.types.str "production" "Infisical environment for generated runtime credential requirements.";
    credentials = opt (lib.types.attrsOf (lib.types.submodule {
      options.source = opt nullStr null "Host-local credential source path.";
    })) { } "Credential source files.";
    extraCredentialFiles = opt (lib.types.attrsOf lib.types.str) { } "Additional credential source files.";
    manageNginx = opt lib.types.bool false "Manage nginx for the public hostname.";
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      { assertion = cfg.instanceId != null; message = "deploymentControlPlaneContainer.instanceId is required."; }
      { assertion = cfg.publicUrl != null; message = "deploymentControlPlaneContainer.publicUrl is required."; }
      { assertion = cfg.image != null || (cfg.imageRegistry != null && cfg.imageRepository != null && cfg.imageDigest != null); message = "deploymentControlPlaneContainer requires image or imageRegistry/imageRepository/imageDigest."; }
      { assertion = imageRef == "" || builtins.match imageRefPattern imageRef != null; message = "deploymentControlPlaneContainer image must be pinned by @sha256:<64 lowercase hex>."; }
      { assertion = cfg.imageDigest == null || builtins.match digestPattern cfg.imageDigest != null; message = "deploymentControlPlaneContainer.imageDigest must be sha256:<64 lowercase hex>."; }
      { assertion = cfg.artifactStore.bucket != null; message = "deploymentControlPlaneContainer.artifactStore.bucket is required."; }
      { assertion = missingCredentialNames == [ ]; message = "deploymentControlPlaneContainer missing credential sources: ${lib.concatStringsSep ", " missingCredentialNames}"; }
      { assertion = nullCredentialNames == [ ]; message = "deploymentControlPlaneContainer credential sources must not be null: ${lib.concatStringsSep ", " nullCredentialNames}"; }
      { assertion = !cfg.manageNginx || cfg.publicHostName != null; message = "deploymentControlPlaneContainer.publicHostName is required when manageNginx = true."; }
    ];
    users.groups.${defaults.group} = { };
    users.users.${defaults.user} = {
      isSystemUser = true;
      group = defaults.group;
    };
    systemd.tmpfiles.rules = map
      (path: "d ${path} 0750 ${defaults.containerUid} ${defaults.containerGid} -")
      [ cfg.recordsRoot cfg.artifactStagingRoot cfg.runtimeRoot ];
    environment.etc.${configEtcName}.text = builtins.toJSON renderedConfig + "\n";
    virtualisation.oci-containers.backend = cfg.containerRuntime;
    virtualisation.oci-containers.containers =
      { ${defaults.serviceContainerName} = serviceContainer; } // workerContainers;
    systemd.services = systemdCredentialServices;
    services.nginx = lib.mkIf cfg.manageNginx {
      enable = true;
      virtualHosts.${cfg.publicHostName}.locations."/".proxyPass =
        "http://${cfg.bindAddress}:${toString cfg.port}";
    };
  };
}
