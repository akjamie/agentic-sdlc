# Contributing to agentic-sdlc

Thank you for your interest in contributing to **agentic-sdlc**! 

`agentic-sdlc` provides deterministic, enterprise-grade governance for AI agent-driven software development. We welcome contributions ranging from bug fixes and documentation improvements to new governance checks and agent skills.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Architecture & Governance Model](#architecture--governance-model)
  - [Change Levels (L0 - L3)](#change-levels-l0---l3)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Local Setup](#local-setup)
- [Development Workflow](#development-workflow)
  - [Running Tests](#running-tests)
  - [Syntax & Lint Check](#syntax--lint-check)
  - [Local CLI Invocation](#local-cli-invocation)
- [Contribution Guidelines & Invariants](#contribution-guidelines--invariants)
  - [1. Zero-Config & Convention over Configuration](#1-zero-config--convention-over-configuration)
  - [2. Cross-Platform Rigor (Windows, macOS, Linux)](#2-cross-platform-rigor-windows-macos-linux)
  - [3. Test Presence & TDD](#3-test-presence--tdd)
  - [4. Bundled Skills Parity](#4-bundled-skills-parity)
- [Pull Request & Review Process](#pull-request--review-process)
  - [Commit Message Conventions](#commit-message-conventions)
  - [CI Quality Gates](#ci-quality-gates)

---

## Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free environment for everyone. Please be respectful, constructive, and collaborative in all discussions, issues, and code reviews.

---

## Architecture & Governance Model

`agentic-sdlc` enforces quality through deterministic code gates rather than manual discipline:
- **The Spec is the authority**: Requirements are captured as testable acceptance criteria with Given/When/Then scenarios.
- **The Gate is the law**: Hard barriers prevent untracked drift, missing tests, or unapproved tampering.
- **Player ≠ Referee**: Authoring agents cannot certify their own implementations; independent AI reviews run in fresh CI contexts.

### Change Levels (L0 - L3)

Contributions are evaluated based on their blast radius and risk:

| Level | Blast Radius | Workflow | Merge Authority |
| :--- | :--- | :--- | :--- |
| **L0 (Trivial)** | Documentation, typos, comments, formatting | **Single PR** (code & docs together) | Automated merge once CI passes |
| **L1 (Bounded)** | Localized bug fixes, internal helpers, test updates | **Single PR** (code & tests together) | Independent AI review passes $\to$ auto-merge |
| **L2 (Cross-Boundary)**| Public CLI commands, API schemas, shared AST models | **Spec-First** (Spec PR $\to$ Impl PR) | Component Owner / Contract test verified |
| **L3 (Critical)** | Security, authentication, cryptography, destructive ops | **Spec-First** (Strict two-phase) | **Mandatory Human Lead Approval** (auto-merge denied) |

---

## Getting Started

### Prerequisites

- **Node.js**: `>= 20.19.0` (Native ES Modules required)
- **Git**: `>= 2.30.0`
- **npm**: `>= 10.0.0`
- *(Optional)* Python 3.10+ with `uv` or `pipx` if running Graphify AST queries locally.

### Local Setup

1. **Fork and clone the repository**:
   ```bash
   git clone https://github.com/<your-username>/agentic-sdlc.git
   cd agentic-sdlc
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```
   *(Note: The codebase has zero bloated runtime dependencies; only `commander` and `yaml` are used).*

3. **Verify the environment**:
   ```bash
   npm test
   ```
   All unit and integration tests should pass cleanly.

---

## Development Workflow

### Running Tests

We use Node.js's native test runner (`node --test`). No external runners (like Jest or Mocha) are required:

- **Run all tests**:
  ```bash
  npm test
  ```
- **Run a specific test file**:
  ```bash
  node --test test/risk.test.js
  node --test test/level.test.js
  node --test test/verify.test.js
  ```

### Syntax & Lint Check

Check syntax integrity across entry points:
```bash
npm run lint
```

### Local CLI Invocation

You can test the CLI locally without installing globally:
```bash
node bin/asdlc.js --help
node bin/asdlc.js status
```

---

## Contribution Guidelines & Invariants

To keep the repository clean, reliable, and enterprise-grade, please follow these non-negotiable architectural principles:

### 1. Zero-Config & Convention over Configuration
Avoid introducing ad-hoc YAML or JSON configuration files unless strictly necessary. Configuration fatigue hurts usability. Sensible defaults, deterministic conventions, and built-in heuristics (like the risk assessment engine in `src/lib/risk.js`) should be favored.

### 2. Cross-Platform Rigor (Windows, macOS, Linux)
- Always normalize file paths to POSIX `/` forward slashes before regex or path matching.
- Protect filesystem cleanup and file copies against Windows transient file locks (`EBUSY` / `EPERM`) by using retry loops (see `src/lib/fs.js`).
- Never assume shell built-ins (e.g., `grep`, `which`, `head`) exist natively on Windows environments.

### 3. Test Presence & TDD
- Every new feature, command, or bug fix **must** be accompanied by automated tests in `test/`.
- The `test-presence` gate in `asdlc verify` will fail any pull request that modifies functional source code under `src/` without corresponding test files.

### 4. Bundled Skills Parity
- Agent skills live in `assets/skills/<skill-name>/SKILL.md` and are mirrored in `.agents/skills/<skill-name>/SKILL.md`.
- **Invariant**: If you modify or add an agent skill, both directories **must remain 100% byte-for-byte identical**. CI runs a strict parity test (`test/skills-parity.test.js`) to enforce this.

---

## Pull Request & Review Process

### Creating a Branch

Create a descriptive feature or fix branch from `main`:
```bash
git checkout -b feat/add-new-verifier
# or
git checkout -b fix/windows-path-normalization
```

### Commit Message Conventions

We adhere to [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature or CLI capability
- `fix:` Bug fix or defect remediation
- `docs:` Documentation improvements or typos
- `test:` Adding or updating test suites
- `refactor:` Code changes that neither fix a bug nor add a feature
- `chore:` Dependency bumps, CI configuration, or maintenance

*Example*:
```bash
git commit -m "feat(risk): add destructive DDL detection to assessment engine"
```

### CI Quality Gates

Every Pull Request triggers automated CI pipelines that verify:
1. **Full test pass**: `node --test` across all suites (Linux, macOS, Windows).
2. **Skills byte-parity**: Verifies identical content between `assets/skills/` and `.agents/skills/`.
3. **Spec & Tamper integrity**: Ensures approved specs cannot be silently altered.
4. **Independent AI Review**: CI runs an automated implementation review using a fresh, un-polluted AI context (`asdlc-impl-review`).

## Licensing

By contributing to `agentic-sdlc`, you agree that your contributions will be licensed under its [Apache License, Version 2.0](LICENSE).

---

## Questions or Need Help?

- Feel free to open an **[Issue](https://github.com/akjamie/agentic-sdlc/issues)** on GitHub.
- Discussions and architectural enhancement proposals are always welcome!
