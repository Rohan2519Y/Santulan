#!/usr/bin/env bash
# Single entry point for the Docker stack (alternative to local dev - see root README "Docker (alternative)").
# Local dev stays the default; this is an additional, separate way to run the same code.
#
# Usage: ./docker.sh <command> [args]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

usage() {
  cat <<'EOF'
Usage: ./docker.sh <command> [args]

  start          Build/start mongo, run migrations, then start backend + frontend
  stop           Stop containers without removing them or their data
  restart        stop, then start
  down           Remove containers (keeps the mongo_data volume - your database survives)
  reset [-y]     Remove containers AND the mongo_data volume - deletes all data permanently
  seed-dev       Seed the synthetic dev accounts (see root README "Dev login credentials")
  logs [service] Follow logs for every service, or just one (e.g. ./docker.sh logs backend)
  status         Show container status
EOF
}

cmd_start() {
  if [ ! -f .env ]; then
    echo "No .env at the repo root. Copy .env.example to .env and fill in real values first." >&2
    exit 1
  fi
  docker compose up -d --build mongo
  echo "Waiting for mongo to be healthy..."
  docker compose up -d --wait mongo
  echo "Applying migrations and seeding reference content..."
  docker compose run --rm migrate
  docker compose up -d --build backend frontend
  echo
  echo "Up: backend on http://localhost:8000, frontend on http://localhost:3000"
  echo "Run './docker.sh seed-dev' once if you want the synthetic dev accounts (see root README)."
}

cmd_stop() { docker compose stop; }

cmd_restart() { cmd_stop; cmd_start; }

cmd_down() { docker compose down; }

cmd_reset() {
  if [ "${1:-}" != "-y" ] && [ "${1:-}" != "--yes" ]; then
    read -r -p "This deletes the Docker MongoDB volume permanently. Type 'reset' to continue: " confirm
    if [ "$confirm" != "reset" ]; then
      echo "Cancelled - nothing was removed."
      exit 1
    fi
  fi
  docker compose down -v
  echo "Removed. Run './docker.sh start' to rebuild from scratch."
}

cmd_seed_dev() { docker compose run --rm seed-dev; }

cmd_logs() { docker compose logs -f "$@"; }

cmd_status() { docker compose ps -a; }

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_restart ;;
  down) cmd_down ;;
  reset) shift; cmd_reset "$@" ;;
  seed-dev) cmd_seed_dev ;;
  logs) shift; cmd_logs "$@" ;;
  status) cmd_status ;;
  -h|--help|help|"") usage ;;
  *) echo "Unknown command: $1" >&2; usage; exit 1 ;;
esac
