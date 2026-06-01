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
