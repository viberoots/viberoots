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
  }
}
