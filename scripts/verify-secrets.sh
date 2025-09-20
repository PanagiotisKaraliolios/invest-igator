#!/usr/bin/env bash
set -euo pipefail

echo "[verify-secrets] Checking working tree for env-like files..."
WORKING=$(find . \
  -type f \
  \( -name '.env' -o -name '.env.*' -o -name '*.env' -o -name '*.env.*' -o -name '*.local' -o -name '.env.local' \) \
  -not -name '.env.example' \
  -not -path './node_modules/*' -not -path './.git/*' | sort -u || true)

if [[ -z "${WORKING}" ]]; then
  echo "[verify-secrets] Working tree: none found"
else
  echo "[verify-secrets] Working tree: potential files found (tracked? -> yes/no):"
  while IFS= read -r f; do
    if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      echo "  yes  $f"
    else
      echo "  no   $f"
    fi
  done <<< "${WORKING}"
fi

echo
echo "[verify-secrets] Checking git history for env-like filenames (post-rewrite)..."
# List filenames across all commits and search for env-like patterns
HISTORY=$(git rev-list --all | xargs -n1 git ls-tree -r --name-only | \
  grep -E '^(.*/)?\\.env(\\..*)?$|\\.env\\.local$|(^|/).*\\.env(\\..*)?$' | sort -u || true)

if [[ -z "${HISTORY}" ]]; then
  echo "[verify-secrets] History: none found"
else
  echo "[verify-secrets] History: filenames still matching patterns:" && echo "${HISTORY}"
fi

echo
if command -v gitleaks >/dev/null 2>&1; then
  echo "[verify-secrets] Running gitleaks scan..."
  gitleaks detect -s . || true
else
  echo "[verify-secrets] gitleaks not installed; skipping. Install: 'brew install gitleaks' or see docs."
fi

echo
if command -v trufflehog >/dev/null 2>&1; then
  echo "[verify-secrets] Running trufflehog scan..."
  trufflehog git file://$PWD || true
else
  echo "[verify-secrets] trufflehog not installed; skipping. Install: 'pipx install trufflehog' or see docs."
fi

echo
echo "[verify-secrets] Done."
