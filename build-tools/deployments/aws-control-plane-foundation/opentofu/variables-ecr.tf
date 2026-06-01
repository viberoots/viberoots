variable "ecr_enabled" {
  type    = bool
  default = true
}

variable "ecr_repository_name" {
  type    = string
  default = "deployment-control-plane"
}

variable "ecr_image_tag_mutability" {
  type    = string
  default = "IMMUTABLE"
  validation {
    condition     = var.ecr_image_tag_mutability == "IMMUTABLE"
    error_message = "ECR repository tags must be immutable."
  }
}

variable "ecr_scan_on_push" {
  type    = bool
  default = true
  validation {
    condition     = var.ecr_scan_on_push
    error_message = "ECR scan-on-push must stay enabled."
  }
}

variable "ecr_lifecycle_policy_json" {
  type    = string
  default = ""
}

variable "ecr_repository_policy_json" {
  type    = string
  default = ""
}

variable "ecr_kms_key_arn" {
  type    = string
  default = ""
}

variable "ecr_import_adoption_metadata" {
  type = object({
    mode               = string
    reviewed_reference = string
    import_block       = string
  })
  default = {
    mode               = "managed"
    reviewed_reference = ""
    import_block       = ""
  }
  validation {
    condition     = contains(["managed", "imported"], var.ecr_import_adoption_metadata.mode)
    error_message = "ECR import adoption mode must be managed or imported."
  }
}
