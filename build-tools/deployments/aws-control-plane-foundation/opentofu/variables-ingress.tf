variable "ingress_enabled" {
  type    = bool
  default = true
}

variable "ingress_type" {
  type    = string
  default = "alb"
  validation {
    condition     = contains(["alb", "nlb"], var.ingress_type)
    error_message = "ingress_type must be alb or nlb."
  }
}

variable "ingress_public_host" {
  type = string
}

variable "ingress_callback_host" {
  type = string
}

variable "ingress_callback_path" {
  type    = string
  default = "/oidc/callback"
}

variable "ingress_service_port" {
  type    = number
  default = 7780
}

variable "ingress_target_instance_id" {
  type    = string
  default = ""
  validation {
    condition     = !var.ingress_enabled || trimspace(var.ingress_target_instance_id) != ""
    error_message = "ingress_target_instance_id is required when ingress_enabled is true."
  }
}

variable "ingress_service_process" {
  type    = string
  default = ""
  validation {
    condition     = !var.ingress_enabled || trimspace(var.ingress_service_process) != ""
    error_message = "ingress_service_process is required when ingress_enabled is true."
  }
}

variable "ingress_service_unit" {
  type    = string
  default = "deployment-control-plane-service.service"
}

variable "ingress_image_digest" {
  type    = string
  default = ""
  validation {
    condition     = !var.ingress_enabled || startswith(var.ingress_image_digest, "sha256:")
    error_message = "ingress_image_digest must be a sha256 digest when ingress_enabled is true."
  }
}

variable "ingress_config_digest" {
  type    = string
  default = ""
  validation {
    condition     = !var.ingress_enabled || startswith(var.ingress_config_digest, "sha256:")
    error_message = "ingress_config_digest must be a sha256 digest when ingress_enabled is true."
  }
}

variable "ingress_target_health_status" {
  type    = string
  default = ""
  validation {
    condition     = !var.ingress_enabled || var.ingress_target_health_status == "healthy"
    error_message = "ingress_target_health_status must come from collected evidence and be healthy."
  }
}

variable "ingress_certificate_arn" {
  type    = string
  default = ""
}

variable "ingress_certificate_not_before" {
  type    = string
  default = ""
  validation {
    condition     = !var.ingress_enabled || trimspace(var.ingress_certificate_not_before) != ""
    error_message = "ingress_certificate_not_before is required for ingress certificate evidence."
  }
}

variable "ingress_certificate_not_after" {
  type    = string
  default = ""
  validation {
    condition     = !var.ingress_enabled || trimspace(var.ingress_certificate_not_after) != ""
    error_message = "ingress_certificate_not_after is required for ingress certificate evidence."
  }
}

variable "ingress_certificate_sans" {
  type    = list(string)
  default = []
}

variable "ingress_certificate_validation_ownership_reference" {
  type    = string
  default = ""
  validation {
    condition     = !var.ingress_enabled || trimspace(var.ingress_certificate_validation_ownership_reference) != ""
    error_message = "ingress certificate validation ownership reviewed reference is required."
  }
}

variable "ingress_certificate_validation_ownership_digest" {
  type    = string
  default = ""
  validation {
    condition     = !var.ingress_enabled || startswith(var.ingress_certificate_validation_ownership_digest, "sha256:")
    error_message = "ingress certificate validation ownership digest must be sha256."
  }
}

variable "ingress_certificate_renewal_reference" {
  type    = string
  default = ""
  validation {
    condition     = !var.ingress_enabled || trimspace(var.ingress_certificate_renewal_reference) != ""
    error_message = "ingress certificate renewal reviewed reference is required."
  }
}

variable "ingress_certificate_renewal_digest" {
  type    = string
  default = ""
  validation {
    condition     = !var.ingress_enabled || startswith(var.ingress_certificate_renewal_digest, "sha256:")
    error_message = "ingress certificate renewal digest must be sha256."
  }
}

variable "ingress_certificate_dns_validation_reference" {
  type    = string
  default = ""
  validation {
    condition     = !var.ingress_enabled || trimspace(var.ingress_certificate_dns_validation_reference) != ""
    error_message = "ingress certificate DNS validation reviewed reference is required."
  }
}

variable "ingress_certificate_dns_validation_digest" {
  type    = string
  default = ""
  validation {
    condition     = !var.ingress_enabled || startswith(var.ingress_certificate_dns_validation_digest, "sha256:")
    error_message = "ingress certificate DNS validation digest must be sha256."
  }
}

variable "ingress_route53_zone_id" {
  type    = string
  default = ""
}

variable "ingress_allowed_client_cidrs" {
  type    = list(string)
  default = []
}

variable "ingress_waf_enabled" {
  type    = bool
  default = true
}
