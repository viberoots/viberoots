variable "supabase_privatelink_enabled" {
  type    = bool
  default = false
}

variable "supabase_privatelink_connection_mode" {
  type    = string
  default = "endpoint"
  validation {
    condition     = contains(["endpoint", "service-network"], var.supabase_privatelink_connection_mode)
    error_message = "supabase_privatelink_connection_mode must be endpoint or service-network."
  }
}

variable "supabase_privatelink_ram_share_arn" {
  type    = string
  default = ""
}

variable "supabase_privatelink_resource_configuration_arn" {
  type    = string
  default = ""
}

variable "supabase_privatelink_endpoint_subnet_ids" {
  type    = list(string)
  default = []
}

variable "supabase_privatelink_private_dns_enabled" {
  type    = bool
  default = true
}

variable "supabase_privatelink_service_network_identifier" {
  type    = string
  default = ""
}

variable "supabase_privatelink_import_adoption_metadata" {
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
}
