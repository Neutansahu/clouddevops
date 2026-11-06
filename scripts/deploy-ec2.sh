#!/bin/bash
# Runs on the EC2 instance through SSM Run Command. Variables are exported by the workflow.
set -euo pipefail
ENV_FILE="/etc/${APP}/${ENVIRONMENT}.env"
PREVIOUS=$(docker inspect --format '{{.Config.Image}}' web 2>/dev/null || true)

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker pull "$IMAGE"

run_container() {
  docker rm -f web >/dev/null 2>&1 || true
  docker run -d --name web --restart unless-stopped -p 8000:8000 --env-file "$ENV_FILE" -e PORT=8000 -e NODE_ENV=production "$1"
}
healthy() {
  for _ in $(seq 1 20); do curl -fsS http://localhost:8000/health >/dev/null && return 0; sleep 3; done
  return 1
}

run_container "$IMAGE"
if healthy; then
  put() { aws ssm put-parameter --region "$REGION" --name "/${APP}/${ENVIRONMENT}/$1" --type String --overwrite --value "$2" >/dev/null; }
  [ -n "$PREVIOUS" ] && [ "${PREVIOUS##*:}" != "$TAG" ] && put previous-tag "${PREVIOUS##*:}"
  put image-tag "$TAG"; put deployed-at "$(date -u +%FT%TZ)"
  docker image prune -f >/dev/null
  exit 0
fi
echo "Health check failed" >&2; docker logs --tail 50 web >&2 || true
if [ -n "$PREVIOUS" ]; then echo "Restoring $PREVIOUS" >&2; run_container "$PREVIOUS"; fi
exit 1
