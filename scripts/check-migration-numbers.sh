#!/usr/bin/env bash
# Fails when two files in supabase/migrations/ share a number (e.g. two 10_*.sql files).
#
# Why: migrations run in number order, and two branches can each add "the next" number without knowing about
# the other. On a pull request, CI checks out the PR combined with the latest main, so a clash between the PR
# and main shows up here before anyone merges. Renaming is left to a person: a migration may already have been
# run on the online database.
#
# Run it yourself (from the repo root, in Git Bash or CI):  bash scripts/check-migration-numbers.sh
set -euo pipefail

dir="${1:-supabase/migrations}"

# The number before the first "_" of every NN_name.sql file.
numbers=$(ls "$dir" | grep -E '^[0-9]+_.*\.sql$' | cut -d_ -f1)
duplicates=$(echo "$numbers" | sort | uniq -d)

if [ -n "$duplicates" ]; then
  highest=$(echo "$numbers" | sort -n | tail -1)
  next=$(printf "%02d" $((10#$highest + 1)))
  for n in $duplicates; do
    # "::error::" makes GitHub show this as a red annotation on the PR.
    echo "::error::Duplicate migration number $n:"
    ls "$dir" | grep -E "^${n}_" | sed 's/^/    /'
  done
  echo "Rename the newer migration to the next free number: ${next}_<name>.sql"
  exit 1
fi

echo "Migration numbers are unique ($(echo "$numbers" | wc -l | tr -d ' ') migrations)."
