#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
data_dir="$project_root/.local/postgres"
log_file="$project_root/.local/postgres.log"
port="${PGPORT:-5433}"
database_user="supplysense"
database_name="supplysense"
database_password="supplysense"

mkdir -p "$project_root/.local"

ensure_database() {
  psql -p "$port" -U "$database_user" -d postgres -c "ALTER ROLE $database_user WITH PASSWORD '$database_password';" >/dev/null
  if ! psql -p "$port" -U "$database_user" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$database_name';" | grep -q 1; then
    createdb -p "$port" -U "$database_user" "$database_name"
  fi
}

case "${1:-status}" in
  init)
    if [ ! -f "$data_dir/PG_VERSION" ]; then
      mkdir -p "$data_dir"
      initdb -D "$data_dir" -U "$database_user" --auth-local=trust --auth-host=scram-sha-256
    fi
    ;;
  start)
    bash "$0" init
    if pg_isready -h 127.0.0.1 -p "$port" -U "$database_user" -d postgres >/dev/null 2>&1; then
      ensure_database
      echo "Local PostgreSQL is already running on port $port."
      exit 0
    fi
    pg_ctl -D "$data_dir" -l "$log_file" -o "-p $port" start -w
    ensure_database
    echo "Local PostgreSQL is running on port $port."
    ;;
  stop)
    if [ -f "$data_dir/postmaster.pid" ]; then
      pg_ctl -D "$data_dir" stop -m fast -w
      echo "Local PostgreSQL stopped."
    else
      echo "Local PostgreSQL is not running."
    fi
    ;;
  status)
    if pg_isready -h 127.0.0.1 -p "$port" -U "$database_user" -d "$database_name" >/dev/null 2>&1; then
      echo "Local PostgreSQL is running on port $port."
    else
      echo "Local PostgreSQL is not running."
      exit 1
    fi
    ;;
  *)
    echo "Usage: $0 {init|start|stop|status}" >&2
    exit 2
    ;;
esac
