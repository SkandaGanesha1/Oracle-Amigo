# Two-Laptop Demo Launcher (cross-platform)
#
# Starts the control plane + two local agents on one machine for the
# A2A v1.0.0 + ANP hardening demo. Useful when you don't have two laptops
# handy; for a real cross-device run see docs/two-laptop-deployment.md.
#
# Usage:  ./scripts/demo-two-laptop.sh
#
# Requires: node 20+, openssl (for secret generation), curl
# Optional: jq (for the smoke checks)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Pick free ports
CONTROL_PLANE_PORT="${CONTROL_PLANE_PORT:-8080}"
AGENT_A_PORT="${AGENT_A_PORT:-3399}"
AGENT_B_PORT="${AGENT_B_PORT:-3400}"

# Generate one-time secrets for the demo
export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-$(openssl rand -hex 32)}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-$(openssl rand -hex 32)}"
export DEV_ADMIN_TOKEN="${DEV_ADMIN_TOKEN:-$(openssl rand -hex 16)}"
export DEFAULT_ORG_SLUG="${DEFAULT_ORG_SLUG:-demo-org}"
export CONTROL_PLANE_PORT
export CONTROL_PLANE_HOST="127.0.0.1"
export CONTROL_PLANE_PUBLIC_URL="http://127.0.0.1:${CONTROL_PLANE_PORT}"

# Persist secrets so the agents can read them
mkdir -p .demo-secrets
{
  echo "JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET"
  echo "JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET"
  echo "DEV_ADMIN_TOKEN=$DEV_ADMIN_TOKEN"
  echo "CONTROL_PLANE_PORT=$CONTROL_PLANE_PORT"
  echo "CONTROL_PLANE_PUBLIC_URL=$CONTROL_PLANE_PUBLIC_URL"
  echo "AGENT_A_PORT=$AGENT_A_PORT"
  echo "AGENT_B_PORT=$AGENT_B_PORT"
} > .demo-secrets/env

echo "==> Building control plane"
npm run build:control-plane --silent

# Cleanup on exit
cleanup() {
  echo
  echo "==> Shutting down"
  if [ -n "${CP_PID:-}" ]; then kill "$CP_PID" 2>/dev/null || true; fi
  if [ -n "${AGENT_A_PID:-}" ]; then kill "$AGENT_A_PID" 2>/dev/null || true; fi
  if [ -n "${AGENT_B_PID:-}" ]; then kill "$AGENT_B_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Starting control plane on port $CONTROL_PLANE_PORT"
node apps/control-plane/dist/main.js > .demo-secrets/cp.log 2>&1 &
CP_PID=$!

# Wait for the control plane to be ready
for i in {1..30}; do
  if curl -sf "http://127.0.0.1:${CONTROL_PLANE_PORT}/health" >/dev/null 2>&1; then
    echo "    control plane is up (PID $CP_PID)"
    break
  fi
  sleep 0.5
  if [ "$i" -eq 30 ]; then
    echo "control plane failed to start; tail of .demo-secrets/cp.log:"
    tail -n 30 .demo-secrets/cp.log
    exit 1
  fi
done

echo "==> Starting agent A on port $AGENT_A_PORT"
AGENTIC_PORT="$AGENT_A_PORT" \
AGENTIC_CONTROL_PLANE_URL="$CONTROL_PLANE_PUBLIC_URL" \
AGENTIC_TENANT="$DEFAULT_ORG_SLUG" \
  npm start --silent > .demo-secrets/agent-a.log 2>&1 &
AGENT_A_PID=$!

echo "==> Starting agent B on port $AGENT_B_PORT"
AGENTIC_PORT="$AGENT_B_PORT" \
AGENTIC_CONTROL_PLANE_URL="$CONTROL_PLANE_PUBLIC_URL" \
AGENTIC_TENANT="$DEFAULT_ORG_SLUG" \
  npm start --silent > .demo-secrets/agent-b.log 2>&1 &
AGENT_B_PID=$!

# Wait for both agents
for i in {1..30}; do
  if curl -sf "http://127.0.0.1:${AGENT_A_PORT}/.well-known/agent-card.json" >/dev/null 2>&1 \
     && curl -sf "http://127.0.0.1:${AGENT_B_PORT}/.well-known/agent-card.json" >/dev/null 2>&1; then
    echo "    both agents are up (A=$AGENT_A_PID, B=$AGENT_B_PID)"
    break
  fi
  sleep 0.5
  if [ "$i" -eq 30 ]; then
    echo "one or more agents failed to start"
    tail -n 30 .demo-secrets/agent-a.log
    tail -n 30 .demo-secrets/agent-b.log
    exit 1
  fi
done

echo
echo "==> Smoke checks"
echo "  - control plane /health:"
curl -sf "http://127.0.0.1:${CONTROL_PLANE_PORT}/health" | (command -v jq >/dev/null && jq . || cat)
echo
echo "  - agent A A2A v1 card:"
curl -sf "http://127.0.0.1:${AGENT_A_PORT}/.well-known/agent-card.json" | (command -v jq >/dev/null && jq '. | {name, protocolVersion, preferredTransport, supportedInterfaces}' || cat)
echo
echo "  - agent B A2A v1 card:"
curl -sf "http://127.0.0.1:${AGENT_B_PORT}/.well-known/agent-card.json" | (command -v jq >/dev/null && jq '. | {name, protocolVersion, preferredTransport, supportedInterfaces}' || cat)
echo
echo "  - control plane admin: list users"
curl -sf "http://127.0.0.1:${CONTROL_PLANE_PORT}/admin/users" -H "X-Admin-Token: $DEV_ADMIN_TOKEN" | (command -v jq >/dev/null && jq . || cat)

echo
echo "==> Demo is live. Secrets saved to .demo-secrets/env (don't commit)."
echo "   Control plane: $CONTROL_PLANE_PUBLIC_URL  (logs: .demo-secrets/cp.log)"
echo "   Agent A:       http://127.0.0.1:$AGENT_A_PORT  (logs: .demo-secrets/agent-a.log)"
echo "   Agent B:       http://127.0.0.1:$AGENT_B_PORT  (logs: .demo-secrets/agent-b.log)"
echo
echo "Press Ctrl+C to stop all three processes."

# Keep script running so the trap fires on exit
wait
