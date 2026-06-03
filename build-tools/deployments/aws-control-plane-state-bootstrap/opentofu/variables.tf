variable "region" {
  description = "AWS region for the remote state bootstrap resources."
  type        = string
}

variable "state_bucket_name" {
  description = "Globally unique S3 bucket name for OpenTofu remote state."
  type        = string
}

variable "state_lock_table_name" {
  description = "DynamoDB table name for OpenTofu state locking."
  type        = string
}

variable "backend_state_key" {
  description = "S3 object key used by the main foundation backend."
  type        = string
  default     = "aws-foundation/deployment-control-plane.tfstate"
}

variable "tags" {
  description = "Tags applied to bootstrap resources."
  type        = map(string)
  default     = {}
}
