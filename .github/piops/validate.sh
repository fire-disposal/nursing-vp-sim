#!/usr/bin/env bash
set -euo pipefail

mapfile -t changed < <(git diff --name-only)
backend_changed=false
frontend_changed=false
for path in "${changed[@]}"; do
  [[ "$path" == backend/* ]] && backend_changed=true
  [[ "$path" == frontend/* ]] && frontend_changed=true
done

if [[ "$backend_changed" == true ]]; then
  pushd backend >/dev/null
  uv sync --frozen --group dev
  uv run ruff check .
  uv run python -m compileall -q core infra modules schemas

  mapfile -t tests < <(printf '%s\n' "${changed[@]}" | sed -n 's#^backend/\(tests/.*\.py\)$#\1#p')
  if (( ${#tests[@]} > 0 )); then
    uv run pytest -q "${tests[@]}"
  fi
  popd >/dev/null
fi

if [[ "$frontend_changed" == true ]]; then
  pnpm install --frozen-lockfile
  pushd frontend >/dev/null
  pnpm lint
  pnpm build
  popd >/dev/null
fi

if [[ "$backend_changed" == false && "$frontend_changed" == false ]]; then
  echo "No backend or frontend source files changed; syntax validation only."
fi
