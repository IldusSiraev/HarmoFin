# Builds every runtime target in one BuildKit session, so the shared
# dependencies/build stages run once instead of once per image.
variable "TAG" {
  default = "local"
}

group "default" {
  targets = ["web", "api", "worker", "migrate"]
}

target "_common" {
  context    = "."
  dockerfile = "infra/docker/Dockerfile"
}

target "web" {
  inherits = ["_common"]
  target   = "web"
  tags     = ["harmofin-web:${TAG}"]
}

target "api" {
  inherits = ["_common"]
  target   = "api"
  tags     = ["harmofin-api:${TAG}"]
}

target "worker" {
  inherits = ["_common"]
  target   = "worker"
  tags     = ["harmofin-worker:${TAG}"]
}

target "migrate" {
  inherits = ["_common"]
  target   = "migrate"
  tags     = ["harmofin-migrate:${TAG}"]
}
