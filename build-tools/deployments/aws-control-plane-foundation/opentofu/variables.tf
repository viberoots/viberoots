variable "region" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "tags" {
  type = map(string)
  validation {
    condition = alltrue([
      for key in ["owner", "environment", "dataClassification", "rollback"] :
      contains(keys(var.tags), key) && trimspace(var.tags[key]) != ""
    ])
    error_message = "tags must include owner, environment, dataClassification, and rollback."
  }
}

variable "vpc_cidr" {
  type    = string
  default = "10.72.0.0/16"
}

variable "existing_vpc_id" {
  type    = string
  default = ""
}

variable "existing_internet_gateway_id" {
  type    = string
  default = ""
}

variable "public_subnet_cidrs" {
  type = map(string)
  validation {
    condition     = length(var.public_subnet_cidrs) >= 1
    error_message = "at least one public subnet CIDR is required for NAT egress."
  }
}

variable "private_subnet_cidrs" {
  type = map(string)
  validation {
    condition     = length(var.private_subnet_cidrs) >= 2
    error_message = "at least two private subnet CIDRs are required."
  }
}

variable "availability_zones" {
  type = map(string)
}

variable "outbound_https_cidrs" {
  type = map(list(string))
  validation {
    condition = alltrue([
      for key in ["infisical", "registry", "reviewed-source", "supabase-api", "provider-apis"] :
      contains(keys(var.outbound_https_cidrs), key) && length(var.outbound_https_cidrs[key]) > 0
    ])
    error_message = "outbound_https_cidrs must explicitly include infisical, registry, reviewed-source, supabase-api, and provider-apis."
  }
}

variable "artifact_bucket_name" {
  type = string
}

variable "artifact_prefix" {
  type    = string
  default = "control-plane/"
}

variable "state_bucket_name" {
  type = string
}

variable "state_lock_table_name" {
  type = string
}

variable "kms_deletion_window_days" {
  type    = number
  default = 30
}
