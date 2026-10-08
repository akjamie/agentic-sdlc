# Jenkins integration

The BU gate runs on Jenkins. **Nothing is installed globally on the agent** —
`asdlc` is a project dependency or an extra SCM checkout (see below).

## What the pipeline does

`assets/ci/Jenkinsfile` (multibranch):

| PR type | Branch | Stage |
|---|---|---|
| spec PR | `asdlc/<id>` | `asdlc lint <ID>` — spec quality (BDD + AC) |
| implementation PR | `asdlc/impl/<id>` | `asdlc gate <ID> --repo <name>` — full CI gate |

The gate checks: artifacts, **approved SHA is merged into the protected branch
(git, no store)**, `READY_FOR_IMPL` flow state, spec quality, `openspec validate`,
and any `gates.external` commands (run with a scrubbed environment).

## Making `asdlc` available (no global install)

Pick one — `Jenkinsfile` auto-detects and fails loudly if neither is present:

**Option A — project dependency**
```jsonc
// package.json
"devDependencies": { "agentic-sdlc": "0.1.0", "@fission-ai/openspec": "1.13.2" }
```
The pipeline runs `npm ci`; `asdlc` resolves to `node_modules/.bin/asdlc`.

**Option B — extra SCM checkout** (best for non-Node repos)
Add a checkout of the `agentic-sdlc` repo to the job and set an environment
variable `ASDLC_TOOLKIT=<workspace>/asdlc-toolkit`. The pipeline runs
`node "$ASDLC_TOOLKIT/bin/asdlc.js"`. No registry, no install, no permissions.

> Never `npm i -g` in the pipeline. Pin versions; treat the agent as ephemeral.

## Setting up the job

1. **New Item → Multibranch Pipeline**, point at the business repo.
2. Add a webhook (or scan trigger) so spec/impl branches build automatically.
3. If using Option B, add the `agentic-sdlc` SCM checkout and set `ASDLC_TOOLKIT`.
4. Optional: post the result back to the PR as a commit status (see
   `github-status.sh`, which takes `CONTEXT`, `STATE`, `TARGET_URL`, and a
   `GITHUB_TOKEN` supplied by Jenkins credentials).

## Local test harness

`jenkins/Dockerfile` + `docker-compose.yml` + `init.groovy.d/` bring up a
throwaway Jenkins that mounts the toolkit and a project, for local verification.
See `docker-compose.yml`. Note `security.groovy` opens the controller — **test
only, never for a shared instance.**

## Approval after merge

Approval is not a Jenkins step and not a store: a merged spec PR *is* the
approval. The repo's `.githooks/post-merge` runs `asdlc merge`, which derives the
approved SHA from the merge commit and stamps `READY_FOR_IMPL`. (Neither the hook
nor the pipeline installs `asdlc` globally.)
