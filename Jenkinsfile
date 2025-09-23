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
          stage('Codegen') {
            steps { sh 'node tools/ci/run-stage.ts --stage codegen' }
          }
          stage('Export Graph') {
            steps { sh 'node tools/ci/run-stage.ts --stage export-graph' }
          }
          stage('Sync Providers (Go)') {
            steps { sh 'node tools/ci/run-stage.ts --stage sync-providers-go' }
          }
          stage('Sync Providers (Node, optional)') {
            steps { sh 'node tools/ci/run-stage.ts --stage sync-providers-node' }
          }
          stage('Generate auto_map') {
            steps { sh 'node tools/ci/run-stage.ts --stage gen-auto-map' }
          }
          stage('Pre-build guard') {
            steps { sh 'node tools/ci/run-stage.ts --stage prebuild-guard' }
          }
          stage('File size lint (warn)') {
            steps { sh 'node tools/ci/run-stage.ts --stage file-size-lint' }
          }
          stage('Patches Lint (strict)') {
            steps { sh 'node tools/ci/run-stage.ts --stage patches-lint' }
          }
          stage('Build graph-generator (Nix)') {
            steps { sh 'node tools/ci/run-stage.ts --stage nix-build-graph-generator' }
          }
          stage('Buck Tests') {
            steps { sh 'node tools/ci/run-stage.ts --stage buck-test' }
          }
          stage('Coverage (merged)') {
            steps {
              sh 'COVERAGE=1 node tools/ci/run-stage.ts --stage buck-test'
              sh 'pnpm coverage:build'
              archiveArtifacts artifacts: 'coverage/**', fingerprint: true, allowEmptyArchive: true
            }
          }
        }
      }
    }
  }
}


