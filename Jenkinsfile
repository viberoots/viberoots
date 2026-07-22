pipeline {
  agent none
  options {
    timestamps()
    ansiColor('xterm')
  }
  environment {
    CI = 'true'
  }
  stages {
    stage('Matrix Build & Test') {
      matrix {
        axes {
          axis { name 'SYSTEM'; values 'aarch64-darwin', 'aarch64-linux', 'x86_64-linux' }
        }
        agent { label "${SYSTEM}" }
        stages {
          stage('Bootstrap workspace') {
            steps {
              sh '''
                set -eu
                if [ -f .gitmodules ]; then
                  git submodule update --init --recursive
                fi
                if [ -x ./viberoots/init ]; then
                  ./viberoots/init
                fi
              '''
            }
          }
          stage('Codegen') {
            steps { sh 'bash "$(if [ -d viberoots/build-tools ]; then printf %s viberoots/build-tools; else printf %s build-tools; fi)/tools/ci/run-stage.sh" --stage codegen' }
          }
          stage('Export Graph') {
            steps { sh 'bash "$(if [ -d viberoots/build-tools ]; then printf %s viberoots/build-tools; else printf %s build-tools; fi)/tools/ci/run-stage.sh" --stage export-graph' }
          }
          stage('Sync Providers') {
            steps { sh 'bash "$(if [ -d viberoots/build-tools ]; then printf %s viberoots/build-tools; else printf %s build-tools; fi)/tools/ci/run-stage.sh" --stage sync-providers' }
          }
          stage('Generate auto_map') {
            steps { sh 'bash "$(if [ -d viberoots/build-tools ]; then printf %s viberoots/build-tools; else printf %s build-tools; fi)/tools/ci/run-stage.sh" --stage gen-auto-map' }
          }
          stage('Pre-build guard') {
            steps { sh 'bash "$(if [ -d viberoots/build-tools ]; then printf %s viberoots/build-tools; else printf %s build-tools; fi)/tools/ci/run-stage.sh" --stage prebuild-guard' }
          }
          stage('Nix-gaps policy gate') {
            steps { sh 'bash "$(if [ -d viberoots/build-tools ]; then printf %s viberoots/build-tools; else printf %s build-tools; fi)/tools/ci/run-stage.sh" --stage nix-gaps-policy' }
          }
          stage('Language graduation gate') {
            steps { sh 'bash "$(if [ -d viberoots/build-tools ]; then printf %s viberoots/build-tools; else printf %s build-tools; fi)/tools/ci/run-stage.sh" --stage langs-validate' }
          }
          stage('CPP Addon Smoke') {
            steps { sh 'bash "$(if [ -d viberoots/build-tools ]; then printf %s viberoots/build-tools; else printf %s build-tools; fi)/tools/ci/run-stage.sh" --stage cpp-addon-smoke' }
          }
          stage('File size lint') {
            steps { sh 'bash "$(if [ -d viberoots/build-tools ]; then printf %s viberoots/build-tools; else printf %s build-tools; fi)/tools/ci/run-stage.sh" --stage file-size-lint' }
          }
          stage('Patches Lint (strict)') {
            steps { sh 'bash "$(if [ -d viberoots/build-tools ]; then printf %s viberoots/build-tools; else printf %s build-tools; fi)/tools/ci/run-stage.sh" --stage patches-lint' }
          }
          stage('Build graph-generator (Nix)') {
            steps { sh 'bash "$(if [ -d viberoots/build-tools ]; then printf %s viberoots/build-tools; else printf %s build-tools; fi)/tools/ci/run-stage.sh" --stage nix-build-graph-generator' }
          }
          stage('Wheelhouse Preload (Python)') {
            steps { sh 'bash "$(if [ -d viberoots/build-tools ]; then printf %s viberoots/build-tools; else printf %s build-tools; fi)/tools/ci/run-stage.sh" --stage wheelhouse-preload' }
          }
          stage('Buck Tests') {
            steps { sh 'bash "$(if [ -d viberoots/build-tools ]; then printf %s viberoots/build-tools; else printf %s build-tools; fi)/tools/ci/run-stage.sh" --stage buck-test' }
          }
          stage('Coverage (merged)') {
            steps {
              sh 'bash "$(if [ -d viberoots/build-tools ]; then printf %s viberoots/build-tools; else printf %s build-tools; fi)/tools/ci/run-stage.sh" --stage buck-test --coverage'
              sh 'pnpm --dir "$(if [ -d viberoots/build-tools ]; then printf %s viberoots; else printf %s .; fi)" coverage:build'
              archiveArtifacts artifacts: 'coverage/**, viberoots/coverage/**', fingerprint: true, allowEmptyArchive: true
            }
          }
        }
      }
    }
    stage('Protected Artifact Reproducibility Production') {
      when {
        beforeAgent true
        environment name: 'VBR_PROTECTED_REPRODUCIBILITY', value: '1'
      }
      matrix {
        axes {
          axis { name 'SYSTEM'; values 'aarch64-darwin', 'aarch64-linux', 'x86_64-linux' }
          axis { name 'BUILDER_SLOT'; values 'one', 'two' }
        }
        agent { label "${SYSTEM}" }
        stages {
          stage('Produce six-case evidence') {
            steps {
              script {
                ws("${env.WORKSPACE}@repro-${env.BUILD_TAG}-${SYSTEM}-${BUILDER_SLOT}") {
                  deleteDir()
                  try {
                    checkout scm
                    sh '''
                  set -eu
                  : "${VBR_REPRODUCIBILITY_REGISTRY_STORE_PATH:?protected registry is required}"
                  : "${VBR_REPRODUCIBILITY_TRANSPORT_ROOT:?protected transport root is required}"
                  : "${VBR_REPRODUCIBILITY_REMOTE_CI_TOOLS:?immutable remote CI tools are required}"
                  : "${VBR_REPRODUCIBILITY_BUILDER_POLICY:?reviewed builder policy is required}"
                  export VBR_GC_MODE=off
                  if [ -f .gitmodules ]; then
                    git submodule update --init --recursive
                  fi
                  ./viberoots/init
                  bash viberoots/build-tools/tools/ci/run-stage.sh --stage export-graph
                  mkdir -p "buck-out/reproducibility"
                  poison_root="$PWD/buck-out/reproducibility/hostile-${BUILDER_SLOT}"
                  mkdir -p "$poison_root/home" "$poison_root/tmp" "$poison_root/xdg-cache" "$poison_root/xdg-config" "$poison_root/xdg-data" "$poison_root/bin"
                  for tool in nix git node buck2 zx-wrapper; do
                    printf '#!/bin/sh\nprintf "poison artifact tool invoked: %%s\\n" "$0" >&2\nexit 97\n' > "$poison_root/bin/$tool"
                    chmod 700 "$poison_root/bin/$tool"
                  done
                  export HOME="$poison_root/home"
                  export TMPDIR="$poison_root/tmp"
                  export XDG_CACHE_HOME="$poison_root/xdg-cache"
                  export XDG_CONFIG_HOME="$poison_root/xdg-config"
                  export XDG_DATA_HOME="$poison_root/xdg-data"
                  export PATH="$poison_root/bin:$PATH"
                  if [ "${BUILDER_SLOT}" = one ]; then
                    export LANG=C LC_ALL=C TZ=UTC0
                  else
                    export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 TZ=Etc/UTC
                  fi
                  for probe in \
                    'CC=/host/compiler' \
                    'PYTHON=/host/language-runtime' \
                    'VBR_PNPM_FINAL_STORE=/host/package-store' \
                    'BUCK_TARGET=//host:evaluation-selector'; do
                    probe_name="${probe%%=*}"
                    probe_value="${probe#*=}"
                    probe_log="$poison_root/${probe_name}.log"
                    if env "$probe_name=$probe_value" \
                      VBR_ARTIFACT_TOOLS_ROOT="${VBR_REPRODUCIBILITY_REMOTE_CI_TOOLS}" \
                      "${VBR_REPRODUCIBILITY_REMOTE_CI_TOOLS}/bin/zx-wrapper" \
                      "${VBR_REPRODUCIBILITY_REMOTE_CI_TOOLS}/share/viberoots-source/build-tools/tools/ci/artifact-environment-negative-probe.ts" \
                      >"$probe_log" 2>&1; then
                      echo "hostile selector probe unexpectedly passed: $probe_name" >&2
                      exit 1
                    fi
                    grep -E 'artifact build rejects ambient selectors:' "$probe_log" >/dev/null || {
                      echo "hostile selector probe lacked remediation: $probe_name" >&2
                      cat "$probe_log" >&2
                      exit 1
                    }
                  done
                    '''
                    def poisonRoot = "${pwd()}/buck-out/reproducibility/hostile-${env.BUILDER_SLOT}"
                    withEnv([
                      "HOME=${poisonRoot}/home",
                      "TMPDIR=${poisonRoot}/tmp",
                      "XDG_CACHE_HOME=${poisonRoot}/xdg-cache",
                      "XDG_CONFIG_HOME=${poisonRoot}/xdg-config",
                      "XDG_DATA_HOME=${poisonRoot}/xdg-data",
                      "PATH=${poisonRoot}/bin:${env.PATH}",
                      "LANG=${env.BUILDER_SLOT == 'one' ? 'C' : 'en_US.UTF-8'}",
                      "LC_ALL=${env.BUILDER_SLOT == 'one' ? 'C' : 'en_US.UTF-8'}",
                      "TZ=${env.BUILDER_SLOT == 'one' ? 'UTC0' : 'Etc/UTC'}"
                    ]) {
                      withCredentials([file(credentialsId: 'secret://ci/hermetic-builds/reproducibility/evidence-store-aws-shared-credentials', variable: 'VBR_REPRODUCIBILITY_EVIDENCE_AWS_CREDENTIALS_FILE')]) {
                        sh '''
                  set -eu
                  : "${VBR_REPRODUCIBILITY_EVIDENCE_AWS_CREDENTIALS_FILE:?protected evidence AWS credentials file is required}"
                  chmod 600 "${VBR_REPRODUCIBILITY_EVIDENCE_AWS_CREDENTIALS_FILE}"
                  env -u NODE_PATH VBR_GC_MODE=off VBR_ARTIFACT_TOOLS_ROOT="${VBR_REPRODUCIBILITY_REMOTE_CI_TOOLS}" \
                    "${VBR_REPRODUCIBILITY_REMOTE_CI_TOOLS}/bin/zx-wrapper" \
                    "${VBR_REPRODUCIBILITY_REMOTE_CI_TOOLS}/share/viberoots-source/build-tools/tools/ci/produce-artifact-reproducibility-matrix-cell.ts" \
                    --system "${SYSTEM}" \
                    --builder-slot "${BUILDER_SLOT}" \
                    --registry "${VBR_REPRODUCIBILITY_REGISTRY_STORE_PATH}" \
                    --transport-root "${VBR_REPRODUCIBILITY_TRANSPORT_ROOT}" \
                    --remote-ci-tools "${VBR_REPRODUCIBILITY_REMOTE_CI_TOOLS}" \
                    --builder-policy "${VBR_REPRODUCIBILITY_BUILDER_POLICY}" \
                    --evidence-store-aws-credentials-file "${VBR_REPRODUCIBILITY_EVIDENCE_AWS_CREDENTIALS_FILE}" \
                    --output-root "buck-out/reproducibility/cell-${SYSTEM}-${BUILDER_SLOT}"
                        '''
                      }
                    }
                    stash name: "repro-records-${SYSTEM}-${BUILDER_SLOT}", includes: "buck-out/reproducibility/cell-${SYSTEM}-${BUILDER_SLOT}/records.txt,buck-out/reproducibility/cell-${SYSTEM}-${BUILDER_SLOT}/observations.txt"
                  } finally {
                    deleteDir()
                  }
                }
              }
            }
          }
        }
      }
    }
    stage('Protected Artifact Reproducibility Aggregate') {
      when {
        beforeAgent true
        environment name: 'VBR_PROTECTED_REPRODUCIBILITY', value: '1'
      }
      agent { label 'x86_64-linux' }
      steps {
        script {
          ws("${env.WORKSPACE}@repro-aggregate-${env.BUILD_TAG}") {
            deleteDir()
            try {
              checkout scm
              ['aarch64-darwin-one', 'aarch64-darwin-two', 'aarch64-linux-one', 'aarch64-linux-two', 'x86_64-linux-one', 'x86_64-linux-two'].each { unstash "repro-records-${it}" }
              sh '''
            set -eu
            : "${VBR_REPRODUCIBILITY_REGISTRY_STORE_PATH:?protected registry is required}"
            : "${VBR_REPRODUCIBILITY_REMOTE_CI_TOOLS:?immutable remote CI tools are required}"
            export VBR_GC_MODE=off
            if [ -f .gitmodules ]; then
              git submodule update --init --recursive
            fi
            ./viberoots/init
            env -u NODE_PATH bash viberoots/build-tools/tools/ci/run-stage.sh --stage export-graph
            mkdir -p "buck-out/reproducibility/aggregate-parent"
              '''
              withCredentials([
                file(credentialsId: 'secret://ci/hermetic-builds/reproducibility/evidence-store-aws-shared-credentials', variable: 'VBR_REPRODUCIBILITY_EVIDENCE_AWS_CREDENTIALS_FILE'),
                file(credentialsId: 'secret://ci/hermetic-builds/reproducibility/evidence-signing-key', variable: 'VBR_REPRODUCIBILITY_SIGNING_KEY_FILE')
              ]) {
                sh '''
            set -eu
            : "${VBR_REPRODUCIBILITY_EVIDENCE_AWS_CREDENTIALS_FILE:?protected evidence AWS credentials file is required}"
            : "${VBR_REPRODUCIBILITY_SIGNING_KEY_FILE:?protected evidence signing key file is required}"
            chmod 600 "${VBR_REPRODUCIBILITY_EVIDENCE_AWS_CREDENTIALS_FILE}"
            chmod 600 "${VBR_REPRODUCIBILITY_SIGNING_KEY_FILE}"
            env -u NODE_PATH VBR_GC_MODE=off VBR_ARTIFACT_TOOLS_ROOT="${VBR_REPRODUCIBILITY_REMOTE_CI_TOOLS}" \
              "${VBR_REPRODUCIBILITY_REMOTE_CI_TOOLS}/bin/zx-wrapper" \
              "${VBR_REPRODUCIBILITY_REMOTE_CI_TOOLS}/share/viberoots-source/build-tools/tools/ci/aggregate-artifact-reproducibility-evidence.ts" \
              --registry "${VBR_REPRODUCIBILITY_REGISTRY_STORE_PATH}" \
              --records-root "buck-out/reproducibility" \
              --production-graph "$PWD/.viberoots/workspace/buck/graph.json" \
              --signing-key-file "${VBR_REPRODUCIBILITY_SIGNING_KEY_FILE}" \
              --evidence-store-aws-credentials-file "${VBR_REPRODUCIBILITY_EVIDENCE_AWS_CREDENTIALS_FILE}" \
              --output-root "buck-out/reproducibility/aggregate-parent/aggregate" \
              > "buck-out/reproducibility/aggregate-observation-paths.json"
                '''
              }
              archiveArtifacts artifacts: 'buck-out/reproducibility/aggregate-observation-paths.json', fingerprint: true
            } finally {
              deleteDir()
            }
          }
        }
      }
    }
  }
}
