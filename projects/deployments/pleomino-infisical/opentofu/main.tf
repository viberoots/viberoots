terraform {
  required_version = ">= 1.8.0"
  required_providers {
    infisical = {
      source  = "infisical/infisical"
      version = ">= 0.16.22"
    }
  }
}

variable "infisical_host" {
  type    = string
  default = "https://app.infisical.com"
}

variable "organization_id" {
  type = string
}

variable "project_name" {
  type    = string
  default = "pleomino-deployments"
}

variable "project_slug" {
  type    = string
  default = "pleomino-deployments"
}

variable "environments" {
  type    = list(string)
  default = ["staging", "prod"]
}

variable "secret_path" {
  type    = string
  default = "/"
}

variable "cloudflare_secret_name" {
  type    = string
  default = "cloudflare_api_token"
}

variable "machine_identity_names" {
  type = map(string)
  default = {
    staging = "pleomino-staging-deploy"
    prod    = "pleomino-prod-deploy"
  }
}

variable "control_plane_credential_file_names" {
  type = map(object({
    client_id_file     = string
    client_secret_file = string
  }))
  default = {
    staging = {
      client_id_file     = "pleomino-staging-infisical-client-id"
      client_secret_file = "pleomino-staging-infisical-client-secret"
    }
    prod = {
      client_id_file     = "pleomino-prod-infisical-client-id"
      client_secret_file = "pleomino-prod-infisical-client-secret"
    }
  }
}

provider "infisical" {
  host = var.infisical_host
}

locals {
  cloudflare_secret_metadata_reconciliation = {
    for environment in var.environments : environment => {
      object_name     = "${var.project_slug}/${environment}${var.secret_path}${var.cloudflare_secret_name}"
      expected_result = "shared Infisical secret ${var.cloudflare_secret_name} exists at ${var.secret_path} in ${environment}"
      provider_gap    = "infisical_secret can manage values with value_wo, but this cutover scaffold must not create placeholder application secret values"
      reconcile_path  = "after the reviewed secret-management command lands, run sprinkleref add/update for secret://deployments/pleomino/cloudflare_api_token in ${environment}; if Infisical adds metadata-only placeholders, add/import that metadata-only object here without secret values"
    }
  }
}

resource "infisical_project" "pleomino" {
  name                       = var.project_name
  slug                       = var.project_slug
  type                       = "secret-manager"
  should_create_default_envs = false
  has_delete_protection      = true
  audit_log_retention_days   = 90
}

resource "infisical_project_environment" "stage" {
  for_each   = toset(var.environments)
  name       = each.value
  slug       = each.value
  project_id = infisical_project.pleomino.id
}

resource "infisical_identity" "deployment" {
  for_each = var.machine_identity_names
  name     = each.value
  role     = "member"
  org_id   = var.organization_id
  metadata = [
    { key = "deployment_id", value = "pleomino-${each.key}" },
    { key = "secret_name", value = var.cloudflare_secret_name },
  ]
}

resource "infisical_identity_universal_auth" "deployment" {
  for_each                    = infisical_identity.deployment
  identity_id                 = each.value.id
  access_token_ttl            = 3600
  access_token_max_ttl        = 3600
  access_token_num_uses_limit = 0
}

resource "infisical_project_identity" "deployment" {
  for_each    = infisical_identity.deployment
  project_id  = infisical_project.pleomino.id
  identity_id = each.value.id
  roles       = [{ role_slug = "viewer" }]
}

output "project_id" {
  value = infisical_project.pleomino.id
}

output "machine_identity_ids" {
  value = { for stage, identity in infisical_identity.deployment : stage => identity.id }
}

output "control_plane_credential_file_names" {
  value = var.control_plane_credential_file_names
}

output "cloudflare_secret_metadata_reconciliation" {
  value = local.cloudflare_secret_metadata_reconciliation
}

output "deployment_runtime_metadata" {
  value = {
    for stage, identity in infisical_identity.deployment : stage => {
      site_url                    = var.infisical_host
      project_name                = var.project_name
      project_slug                = var.project_slug
      project_id                  = infisical_project.pleomino.id
      environment                 = stage
      secret_path                 = var.secret_path
      machine_identity_id         = identity.id
      machine_identity_name       = identity.name
      client_id_file_name         = var.control_plane_credential_file_names[stage].client_id_file
      client_secret_file_name     = var.control_plane_credential_file_names[stage].client_secret_file
      cloudflare_secret_name      = var.cloudflare_secret_name
      preferred_credential_source = "infisical_machine_identity_universal_auth"
    }
  }
}
