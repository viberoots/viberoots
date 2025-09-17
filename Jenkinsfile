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
          stage('Build graph-generator (Nix)') {
            steps { sh 'node tools/ci/run-stage.ts --stage nix-build-graph-generator' }
          }
          stage('Buck Tests') {
            steps { sh 'node tools/ci/run-stage.ts --stage buck-test' }
          }
          stage('Stale check') {
            steps {
              sh 'git diff --exit-code third_party/providers/ || (echo "Generated providers are stale" && exit 1)'
              sh 'git diff --exit-code tools/buck/graph.json || (echo "graph.json is stale" && exit 1)'
            }
          }
        }
      }
    }
  }
}


