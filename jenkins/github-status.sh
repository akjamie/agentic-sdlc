#!/bin/sh
# Post a GitHub commit status for the project HEAD (outbound Jenkins -> GitHub).
# This is what makes a check appear on the PR. The controller does NOT need to
# be reachable from GitHub for this direction to work.
#
# env: GITHUB_TOKEN (required), STATE, CONTEXT, TARGET_URL, REPO_FULL, PROJECT_DIR
PROJECT_DIR="${PROJECT_DIR:-/workspace/project}"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "[asdlc] GITHUB_TOKEN not set; skipping GitHub commit status"
  exit 0
fi

GIT="git -c safe.directory=* -C $PROJECT_DIR"
REPO_FULL="${REPO_FULL:-$($GIT remote get-url origin 2>/dev/null | sed -e 's#.*github.com[/:]##' -e 's#\.git$##')}"
SHA="${SHA_OVERRIDE:-$($GIT rev-parse HEAD 2>/dev/null)}"
if [ -z "$REPO_FULL" ] || [ -z "$SHA" ]; then
  echo "[asdlc] cannot resolve repo/sha; skipping GitHub commit status"
  exit 0
fi

RESP="$(curl -s -w '\n%{http_code}' -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO_FULL/statuses/$SHA" \
  -d "{\"state\":\"$STATE\",\"context\":\"$CONTEXT\",\"target_url\":\"$TARGET_URL\",\"description\":\"asdlc $CONTEXT\"}")"
CODE="$(printf '%s' "$RESP" | tail -n1)"
echo "[asdlc] github status context=$CONTEXT state=$STATE http=$CODE repo=$REPO_FULL sha=$(echo "$SHA" | cut -c1-8)"
if [ "$CODE" != "201" ]; then printf '%s' "$RESP" | sed '$d' | head -c 400; echo ""; fi
