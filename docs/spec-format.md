# Specification Format & Linting Reference (`spec.md`)

> **The definitive authoring guide and troubleshooting manual for Agentic SDLC specifications.**  
> Covers document anatomy, deterministic BDD rules (R0–R8), pass/fail worked examples, and actionable remedies for lint rejections.

---

## 📖 Table of Contents

1. [Philosophy: Why Deterministic Linting?](#-philosophy-why-deterministic-linting)
2. [Specification Anatomy & File Placement](#-specification-anatomy--file-placement)
3. [The R0–R8 Rulebook: Worked Examples](#-the-r0r8-rulebook-worked-examples)
   - [R0: Requirement Declaration (`R0-no-requirements`)](#r0-requirement-declaration-r0-no-requirements)
   - [R1: Capability Purpose (`R1-purpose`)](#r1-capability-purpose-r1-purpose)
   - [R2: Normative RFC-2119 Statements (`R2-normative`)](#r2-normative-rfc-2119-statements-r2-normative)
   - [R3: Concrete Scenarios (`R3-scenario`)](#r3-concrete-scenarios-r3-scenario)
   - [R4: BDD GIVEN / WHEN / THEN Syntax (`R4-when`, `R4-then`, `R4-given`)](#r4-bdd-given--when--then-syntax-r4-when-r4-then-r4-given)
   - [R5: Acceptance Criteria & Scenario Coverage (`R5-ac`, `R5-scenario-coverage`)](#r5-acceptance-criteria--scenario-coverage-r5-ac-r5-scenario-coverage)
   - [R6: Test Mapping & Traceability (`R6-ac-test`, `R6-test-exists`)](#r6-test-mapping--traceability-r6-ac-test-r6-test-exists)
   - [R7: Test Strategy (`R7-test-strategy`)](#r7-test-strategy-r7-test-strategy)
   - [R8: Deprecation & Removal Justification (`R8-removed-reason`)](#r8-deprecation--removal-justification-r8-removed-reason)
4. [Additional Pre-Flight Lint Checks (`design.md`)](#-additional-pre-flight-lint-checks-designmd)
5. [Troubleshooting Lint Rejections: 1-Minute Remedies](#-troubleshooting-lint-rejections-1-minute-remedies)
6. [Policy as Code: Customizing Rule Severities](#-policy-as-code-customizing-rule-severities)
7. [The Golden Master: Complete Compliant Spec Template](#-the-golden-master-complete-compliant-spec-template)

---

## 🎯 Philosophy: Why Deterministic Linting?

In autonomous AI-driven software development, **unambiguous specifications are the contract**. If an AI coding agent receives a vague, prose-heavy user story, it will hallucinate edge cases, make unverifiable architectural assumptions, or write trivial tests that pass without proving correctness.

Traditional approaches either:
1. Rely exclusively on LLM prompts ("*Please review this spec and ensure it is testable*"), leading to non-deterministic review jitter where the same spec passes on Monday and fails on Tuesday.
2. Require tedious, multi-hour human meetings to debate formatting and testability.

Agentic SDLC separates concerns into two distinct verification layers:
1. **Deterministic BDD Quality Gate (`asdlc lint`)**: A sub-second, zero-LLM regex and structural parser enforcing strict BDD semantics, normative RFC-2119 keywords, acceptance criteria counts, and bidirectional test file mappings.
2. **Semantic Verification (`CI Spec Review`)**: Independent AI and human Tech Lead review focusing on architectural fitness, business risk, and domain logic.

> [!IMPORTANT]
> **No change can proceed to human review or implementation without passing `asdlc lint` with 0 blockers.**  
> If lint fails, do not argue with the CI bot—consult this document, apply the 1-minute fix, and re-run.

---

## 📂 Specification Anatomy & File Placement

### Location Conventions

All specification deltas belong inside the active change directory:

```text
openspec/
└── changes/
    └── <change-id>/                 # e.g. user-login-with-jwt
        ├── explore.md               # Stage 1: Codebase discovery & knowledge graph
        ├── clarifications.md        # Stage 2: Settle design trade-offs
        ├── proposal.md              # High-level intent, risk tier & impact
        ├── design.md                # Technical design (mandatory for UI & external APIs)
        └── specs/                   # Stage 2/3: Precise capability deltas
            └── <capability-name>/
                └── spec.md          # e.g. auth/spec.md, session/spec.md
```

### Document Structure Outline

A compliant `spec.md` follows this standard hierarchy:

```markdown
# Capability Specification: <Capability Name>

## Purpose
<At least 50 characters describing why this capability exists, what value it brings, and who uses it.>

## ADDED Requirements  (or ## MODIFIED Requirements / ## REMOVED Requirements)

### Requirement: <Requirement Name>
The system SHALL / MUST <normative action>.

#### Scenario: <Scenario Name>
- **GIVEN** <precondition or initial system state>
- **WHEN** <trigger event, action, or payload submission>
- **THEN** <deterministic outcome, assertion, or response>

**Acceptance criteria**
- [ ] AC1: <Verifiable assertion matching Scenario 1> (test: <test-file-path>)
- [ ] AC2: <Verifiable assertion matching Scenario 2> (test: <test-file-path>)

## Test Strategy
<Summary of test layers: unit, integration, contract, or end-to-end tests validating this capability.>
```

---

## 🛠️ The R0–R8 Rulebook: Worked Examples

| Rule ID | Name | Default Severity | Description |
| :--- | :--- | :---: | :--- |
| **`R0-no-requirements`** | Requirement Declaration | `blocker` | Spec must declare at least one `### Requirement:`. |
| **`R1-purpose`** | Capability Purpose | `blocker` | `## Purpose` section must be present and >= 50 characters. |
| **`R2-normative`** | Normative Keyword | `blocker` | Requirement body must contain RFC-2119 `SHALL` or `MUST`. |
| **`R3-scenario`** | Scenario Presence | `blocker` | Every requirement must define at least one `#### Scenario:`. |
| **`R4-when`** | BDD WHEN Clause | `blocker` | Scenario must contain `**WHEN**`. |
| **`R4-then`** | BDD THEN Clause | `blocker` | Scenario must contain `**THEN**`. |
| **`R4-given`** | BDD GIVEN Clause | `major` | Scenario must contain `**GIVEN**`. |
| **`R5-ac`** | Acceptance Criteria | `blocker` | Requirement must have an `**Acceptance criteria**` list (`- [ ] AC1:`). |
| **`R5-scenario-coverage`** | Scenario AC Coverage | `blocker` | Number of ACs must be greater than or equal to number of scenarios. |
| **`R6-ac-test`** | Test File Mapping | `blocker` | Every AC line must end with `(test: <path>)`. |
| **`R6-ac-missing-test`** | Test Physical Existence | `blocker` | (Enforced at `verify`) Referenced test file must exist on disk. |
| **`R7-test-strategy`** | Test Strategy Section | `blocker` | Top-level `## Test Strategy` must exist and be non-empty. |
| **`R8-removed-reason`** | Removal Justification | `major` | Any requirement under `## REMOVED Requirements` requires `**Reason**`. |

---

### R0: Requirement Declaration (`R0-no-requirements`)

- **Code**: `R0-no-requirements`
- **Severity**: `blocker`
- **Why it matters**: A spec without requirements is an essay, not an executable contract. The engine extracts individual requirements to track task-level progress and coverage.

#### ❌ Bad (Fails Lint)
```markdown
# Spec Delta: Payment Processing

We are adding Stripe payments to our checkout system so customers can pay with cards.
It should support Visa and Mastercard.
```
*Linter Error:* `[BLOCKER] R0-no-requirements: No "### Requirement:" found`

#### ✅ Good (Passes Lint)
```markdown
# Spec Delta: Payment Processing

## Purpose
Enables customers to securely complete checkout payments using credit and debit cards via Stripe.

## ADDED Requirements

### Requirement: Card Payment Processing
The system SHALL tokenize card details and process charges via the Stripe API.
```

---

### R1: Capability Purpose (`R1-purpose`)

- **Code**: `R1-purpose`
- **Severity**: `blocker` (Checked when `## ADDED Requirements` is present)
- **Why it matters**: A new capability must articulate its business rationale. Short, trivial summaries (e.g. "Adds export.") lead to misaligned implementations and scope creep.

#### ❌ Bad (Fails Lint)
```markdown
## Purpose
Data export.
```
*Linter Error:* `[BLOCKER] R1-purpose: Purpose missing or shorter than 50 characters (## Purpose)`

#### ✅ Good (Passes Lint)
```markdown
## Purpose
This capability lets enterprise administrators securely export audit event logs into portable, cryptographically signed CSV archives.
```
*(Length: 135 characters, clearly stating target user, action, format, and security constraints).*

---

### R2: Normative RFC-2119 Statements (`R2-normative`)

- **Code**: `R2-normative`
- **Severity**: `blocker`
- **Why it matters**: RFC-2119 keywords (`SHALL`, `MUST`) distinguish mandatory system contracts from optional suggestions (`should`, `may`, `could`). Ambiguous phrasing leads AI agents to treat critical validation as optional.

#### ❌ Bad (Fails Lint)
```markdown
### Requirement: Password Validation
The system will check that user passwords have at least 8 characters and it would be good to require a number.
```
*Linter Error:* `[BLOCKER] R2-normative: "Password Validation" has no SHALL/MUST statement`

#### ✅ Good (Passes Lint)
```markdown
### Requirement: Password Validation
The system SHALL reject any password submission containing fewer than 8 characters or lacking at least one numeric digit.
```

---

### R3: Concrete Scenarios (`R3-scenario`)

- **Code**: `R3-scenario`
- **Severity**: `blocker`
- **Why it matters**: High-level requirements describe *intent*; scenarios describe *observable behavior*. Without scenarios, developers and agents cannot derive unit or integration test cases.

#### ❌ Bad (Fails Lint)
```markdown
### Requirement: Rate Limiting
The system SHALL throttle excessive requests.

**Acceptance criteria**
- [ ] AC1: Throttles after 100 requests (test: test/ratelimit.test.js)
```
*Linter Error:* `[BLOCKER] R3-scenario: "Rate Limiting" has no Scenario`

#### ✅ Good (Passes Lint)
```markdown
### Requirement: Rate Limiting
The system SHALL throttle excessive requests by returning HTTP 429 when client limits are exceeded.

#### Scenario: Client exceeds rate threshold
- **GIVEN** a client with an active API token
- **WHEN** the client submits 101 requests within a 60-second window
- **THEN** the server returns HTTP 429 Too Many Requests with a `Retry-After` header

**Acceptance criteria**
- [ ] AC1: Returns HTTP 429 when request count exceeds 100/min (test: test/ratelimit.test.js)
```

---

### R4: BDD GIVEN / WHEN / THEN Syntax (`R4-when`, `R4-then`, `R4-given`)

- **Codes**: `R4-when` (`blocker`), `R4-then` (`blocker`), `R4-given` (`major`)
- **Why it matters**: Behavioral test-driven development requires explicit cause-and-effect structure:
  - **GIVEN**: Context, initial database state, or user permissions.
  - **WHEN**: The stimulus or action taken.
  - **THEN**: The observable outcome or assertion.

#### ❌ Bad (Fails Lint)
```markdown
#### Scenario: Invalid login
When a user types the wrong password, they see an error message.
```
*Linter Errors:*
- `[BLOCKER] R4-when: Scenario "Invalid login" missing WHEN`
- `[BLOCKER] R4-then: Scenario "Invalid login" missing THEN`
- `[MAJOR] R4-given: Scenario "Invalid login" missing GIVEN`

*(Note: The linter requires bold markdown keywords: `- **WHEN**`, `- **THEN**`, `- **GIVEN**`).*

#### ✅ Good (Passes Lint)
```markdown
#### Scenario: Invalid login
- **GIVEN** an existing registered user "alice@example.com"
- **WHEN** a login request is submitted with password "WrongSecret99!"
- **THEN** the system returns HTTP 401 Unauthorized with error code `INVALID_CREDENTIALS`
```

---

### R5: Acceptance Criteria & Scenario Coverage (`R5-ac`, `R5-scenario-coverage`)

- **Codes**: `R5-ac` (`blocker`), `R5-scenario-coverage` (`blocker`)
- **Why it matters**:
  - `R5-ac` ensures requirements have verifiable checkboxes that track implementation progress.
  - `R5-scenario-coverage` enforces the invariant that **every scenario must have at least one dedicated acceptance criterion**. A common anti-pattern is writing three complex edge-case scenarios but only creating one happy-path AC checkbox.

#### ❌ Bad: Missing Acceptance Criteria (`R5-ac`)
```markdown
### Requirement: Token Refresh
The system SHALL refresh expired access tokens using a valid refresh token.

#### Scenario: Successful refresh
- **GIVEN** a valid refresh token in an HTTP-only cookie
- **WHEN** the client requests POST /auth/refresh
- **THEN** a new access token is returned
```
*Linter Error:* `[BLOCKER] R5-ac: "Token Refresh" has no Acceptance criteria (AC<n>)`

#### ❌ Bad: Insufficient Scenario Coverage (`R5-scenario-coverage`)
```markdown
### Requirement: Token Refresh
The system SHALL refresh expired access tokens using a valid refresh token.

#### Scenario: Successful refresh
- **GIVEN** a valid refresh token in an HTTP-only cookie
- **WHEN** the client requests POST /auth/refresh
- **THEN** a new access token is returned

#### Scenario: Revoked refresh token
- **GIVEN** a revoked refresh token
- **WHEN** the client requests POST /auth/refresh
- **THEN** the request is rejected with HTTP 401

**Acceptance criteria**
- [ ] AC1: Generates new access token on valid refresh (test: test/auth.test.js)
```
*Linter Error:* `[BLOCKER] R5-scenario-coverage: "Token Refresh" defines 2 scenario(s) but only 1 acceptance criteria (each scenario requires AC coverage)`

#### ✅ Good (Passes Lint)
```markdown
### Requirement: Token Refresh
The system SHALL refresh expired access tokens using a valid refresh token.

#### Scenario: Successful refresh
- **GIVEN** a valid refresh token in an HTTP-only cookie
- **WHEN** the client requests POST /auth/refresh
- **THEN** a new access token is returned

#### Scenario: Revoked refresh token
- **GIVEN** a revoked refresh token
- **WHEN** the client requests POST /auth/refresh
- **THEN** the request is rejected with HTTP 401

**Acceptance criteria**
- [ ] AC1: Generates new access token on valid refresh (test: test/auth.test.js)
- [ ] AC2: Rejects revoked refresh tokens with HTTP 401 (test: test/auth.test.js)
```

---

### R6: Test Mapping & Traceability (`R6-ac-test`, `R6-test-exists`)

- **Codes**: `R6-ac-test` (`blocker`), `R6-ac-missing-test` (`blocker` during verification)
- **Why it matters**: Acceptance criteria without explicit test mappings are untestable decorations. Every AC must state which test suite file will verify its fulfillment.

> [!NOTE]
> **Stage 3 (Lint) vs. Stage 6 (Verify)**:
> - At **`asdlc lint`** (Stage 3), only the syntactic presence of `(test: <path>)` is checked. The test file itself does not need to exist yet, because implementation tests are created in Stage 5 (`asdlc apply` / TDD loop).
> - At **`asdlc verify`** (Stage 6), the engine checks `repoRoot` to guarantee the test file physically exists on disk and contains passing test assertions.

#### ❌ Bad (Fails Lint)
```markdown
**Acceptance criteria**
- [ ] AC1: Generates new access token on valid refresh
- [ ] AC2: Rejects revoked refresh tokens with HTTP 401 [test: tests/auth.spec.js]
```
*Linter Errors:*
- `[BLOCKER] R6-ac-test: "AC1" has no (test: <path>) mapping`
- `[BLOCKER] R6-ac-test: "AC2" has no (test: <path>) mapping` *(Must use parentheses `(test: <path>)`, not square brackets)*

#### ✅ Good (Passes Lint)
```markdown
**Acceptance criteria**
- [ ] AC1: Generates new access token on valid refresh (test: test/auth.test.js)
- [ ] AC2: Rejects revoked refresh tokens with HTTP 401 (test: test/auth.test.js)
```

---

### R7: Test Strategy (`R7-test-strategy`)

- **Code**: `R7-test-strategy`
- **Severity**: `blocker`
- **Why it matters**: Specifications must outline test distribution across the testing pyramid (unit, integration, end-to-end, performance, or mocks).

#### ❌ Bad (Fails Lint)
*(Omitting the `## Test Strategy` heading entirely, or leaving it blank)*
*Linter Error:* `[BLOCKER] R7-test-strategy: Missing or empty ## Test Strategy (## Test Strategy)`

#### ✅ Good (Passes Lint)
```markdown
## Test Strategy
- **Unit Tests**: Mock the Stripe client and verify token parsing in `test/unit/stripe-parser.test.js`.
- **Integration Tests**: Spin up the local Express server with an ephemeral SQLite database to test `/api/checkout` end-to-end in `test/integration/checkout.test.js`.
- **Error Invariants**: Assert invalid card formats and network timeouts trigger predictable HTTP 400 and 504 responses in `test/integration/checkout-errors.test.js`.
```

---

### R8: Deprecation & Removal Justification (`R8-removed-reason`)

- **Code**: `R8-removed-reason`
- **Severity**: `major`
- **Why it matters**: When deprecating or removing capabilities under `## REMOVED Requirements`, authors must provide explicit reasoning to prevent accidental contract deletion or breaking downstream consumers without migration paths.

#### ❌ Bad (Fails Lint)
```markdown
## REMOVED Requirements

### Requirement: Legacy Basic Auth
The system will no longer support HTTP Basic Auth.
```
*Linter Error:* `[MAJOR] R8-removed-reason: REMOVED "Legacy Basic Auth" lacks **Reason**`

#### ✅ Good (Passes Lint)
```markdown
## REMOVED Requirements

### Requirement: Legacy Basic Auth
The system SHALL remove support for HTTP Basic Auth headers.

**Reason**: Deprecated in favor of Bearer JWT tokens in v2.0; remaining active clients have completed migration per RFC-084.
```

---

## 🎨 Additional Pre-Flight Lint Checks (`design.md`)

Beyond pure BDD syntax in `spec.md`, `asdlc lint` deterministically scans `proposal.md` and `specs/**/*.md` for keywords indicating **UI/Frontend** or **3rd-Party / External API** modifications (such as `ui`, `ux`, `frontend`, `modal`, `button`, `component`, `css`, `third-party`, `external api`, `stripe`, `oauth`, `webhook`).

When detected:
1. **`design.md` Presence**: A `design.md` file is strictly required. Missing it causes:  
   `[FAIL] design.md: design.md is mandatory for UI and external API changes (run asdlc new --design or author design.md)`
2. **Substance Check**: `design.md` must contain real technical specifications. If it contains only unedited HTML comments or template boilerplate (<150 non-comment characters), lint fails:  
   `[FAIL] design.md: design.md contains only unedited template placeholders; fill in technical design`
3. **UI Visual Acceptance Criteria**: Frontend specifications must declare explicit visual ACs covering responsive layouts (mobile, tablet, desktop) and interactive states (loading spinner, empty state, error banner).

---

## 🚀 Troubleshooting Lint Rejections: 1-Minute Remedies

| Linter Output / Message | Root Cause | 1-Minute Fix |
| :--- | :--- | :--- |
| `[FAIL] change: change '<slug>' not found` | Change directory missing from `openspec/changes/`. | Verify your slug with `asdlc status` or run `asdlc new "<intent>"`. |
| `[FAIL] explore.md: run asdlc new <ID>` | Stage 1 artifact missing. | Run `asdlc new <ID>` to scaffold and ground the knowledge graph. |
| `[FAIL] proposal.md: proposal.md missing` | Proposal document not found. | Create `proposal.md` with problem statement and risk assessment. |
| `[FAIL] spec delta: no spec delta present` | No `spec.md` files under `specs/`. | Create `openspec/changes/<ID>/specs/<capability>/spec.md`. |
| `[FAIL] design.md is mandatory for UI...` | Change touches frontend or external APIs without design doc. | Author `design.md` documenting architecture, components, and contracts. |
| `[BLOCKER] R0-no-requirements: No "### Requirement:" found` | Heading level is wrong or typo in header. | Change heading to exact format: `### Requirement: <Name>`. |
| `[BLOCKER] R1-purpose: Purpose missing or shorter than 50 characters` | Purpose is blank or too short. | Expand `## Purpose` to explain value, user, and context (>= 50 chars). |
| `[BLOCKER] R2-normative: "<Name>" has no SHALL/MUST statement` | Requirement uses weak verbs ("should", "will", "can"). | Add at least one sentence using uppercase `SHALL` or `MUST`. |
| `[BLOCKER] R3-scenario: "<Name>" has no Scenario` | Requirement jumps straight to ACs without behavior. | Add at least one `#### Scenario: <Name>` section. |
| `[BLOCKER] R4-when: Scenario "<Name>" missing WHEN` | Gherkin when clause missing or formatted without bolding. | Add `- **WHEN** <trigger action>`. |
| `[BLOCKER] R4-then: Scenario "<Name>" missing THEN` | Gherkin then clause missing or formatted without bolding. | Add `- **THEN** <verifiable result>`. |
| `[MAJOR] R4-given: Scenario "<Name>" missing GIVEN` | Gherkin precondition missing. | Add `- **GIVEN** <initial state>`. |
| `[BLOCKER] R5-ac: "<Name>" has no Acceptance criteria (AC<n>)` | Missing checkbox list header or format. | Add `**Acceptance criteria**` followed by `- [ ] AC1: ...`. |
| `[BLOCKER] R5-scenario-coverage: defines N scenarios but only M ACs` | More scenarios than AC checkboxes. | Add AC checkboxes so that `count(ACs) >= count(Scenarios)`. |
| `[BLOCKER] R6-ac-test: "<ACn>" has no (test: <path>) mapping` | Missing `(test: ...)` tag at the end of the line. | Append `(test: path/to/test.js)` inside parentheses. |
| `[BLOCKER] R7-test-strategy: Missing or empty ## Test Strategy` | Heading missing or empty at top level. | Add `## Test Strategy` with unit, integration, and E2E breakdown. |
| `[MAJOR] R8-removed-reason: REMOVED "<Name>" lacks **Reason**` | Deprecated requirement has no explanation. | Add `**Reason**: <rationale>` inside the requirement body. |

---

## ⚙️ Policy as Code: Customizing Rule Severities

Rule severities can be configured per repository in `openspec/config.yaml` under `lint.rules`. This allows teams to adopt rules incrementally or treat specific rules as advisory during legacy migrations:

```yaml
# openspec/config.yaml
lint:
  version: 2
  rules:
    R0-no-requirements: blocker
    R1-purpose: blocker
    R2-normative: blocker
    R3-scenario: blocker
    R4-when: blocker
    R4-then: blocker
    R4-given: major            # Can be downgraded to minor or off
    R5-ac: blocker
    R5-scenario-coverage: blocker
    R6-ac-test: blocker
    R7-test-strategy: blocker
    R8-removed-reason: major
```

Allowed severity values:
- `blocker`: Halts `asdlc lint` and exits with code 1. Prevents PR creation.
- `major`: Emits a visible warning in output; does not block PR unless configured strictly.
- `minor`: Advisory information.
- `off`: Disables the rule completely.

---

## 🏆 The Golden Master: Complete Compliant Spec Template

Below is a complete, copy-pasteable example of a production-grade `spec.md` that passes `asdlc lint` with 0 blockers:

```markdown
# Capability Specification: Token Authentication Service

## Purpose
Provides secure token-based authentication for mobile and web clients using short-lived signed JWTs and cryptographically secure refresh token rotation.

## ADDED Requirements

### Requirement: Issue Access Token
The system SHALL validate client credentials and issue a signed JSON Web Token (JWT) with an expiration lifespan of 15 minutes.

#### Scenario: Successful login credential exchange
- **GIVEN** a registered user with email "engineer@example.com" and an active account status
- **WHEN** a POST request is sent to `/api/v1/auth/tokens` with valid credentials
- **THEN** the server returns HTTP 200 OK with `access_token`, `token_type: "Bearer"`, and `expires_in: 900`

#### Scenario: Invalid password rejected
- **GIVEN** a registered user with email "engineer@example.com"
- **WHEN** a POST request is sent to `/api/v1/auth/tokens` with an incorrect password
- **THEN** the server returns HTTP 401 Unauthorized with error code `AUTH_INVALID_CREDENTIALS`

**Acceptance criteria**
- [ ] AC1: Generates valid RS256-signed JWT with 15-minute TTL on valid login (test: test/auth/tokens.test.js)
- [ ] AC2: Rejects invalid password submissions with HTTP 401 (test: test/auth/tokens.test.js)

### Requirement: Refresh Token Rotation
The system MUST invalidate previous refresh tokens upon use and issue a new single-use refresh token.

#### Scenario: Refresh token reuse detection
- **GIVEN** an already consumed refresh token `rt_prev_123`
- **WHEN** an attacker attempts to exchange `rt_prev_123` for a new access token
- **THEN** the server revokes the entire token family, invalidates all active sessions for the user, and returns HTTP 403 Forbidden

**Acceptance criteria**
- [ ] AC1: Detects reused refresh tokens, invalidates active sessions, and emits security audit alert (test: test/auth/rotation.test.js)

## Test Strategy
- **Unit Testing**: JWT claims, expiration calculation, and RS256 signature verification in `test/auth/jwt-unit.test.js`.
- **Integration Testing**: Ephemeral Redis session store testing for refresh token families and rotation concurrency in `test/auth/rotation.test.js`.
- **Negative Invariants**: Brute-force rate limiting and malformed payload fuzzing in `test/auth/tokens.test.js`.
```
