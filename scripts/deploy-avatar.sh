#!/usr/bin/env bash
# 快速部署 Avatar 插件：同步 → 重启（不阻塞）→ 服务器内侧轮询 health，就绪即返回
set -euo pipefail
HOST="${AVATAR_HOST:-root@8.130.211.168}"
KEY="${AVATAR_KEY:-$HOME/.ssh/id_ed25519_boqi}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
START=$(date +%s)

cd "$REPO/packages"
tar czf - --exclude=node_modules --exclude="*.map" avatar 2>/dev/null | ssh -i "$KEY" "$HOST" 'tar xzf - -C /opt/avatar/packages'

ssh -i "$KEY" "$HOST" '
  systemctl restart avatar --no-block >/dev/null 2>&1 || true
  for i in $(seq 1 90); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://127.0.0.1:50999/api/avatar/health || true)
    if [ "$code" = "200" ]; then echo ready; exit 0; fi
    sleep 1
  done
  exit 1
'

echo "deployed in $(( $(date +%s) - START ))s"
