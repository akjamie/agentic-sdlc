# Contributing to agentic-sdlc

Thank you for your interest in contributing to **agentic-sdlc**! 

This repository contains the source code for the `asdlc` CLI toolchain and its governance engine. We welcome contributions from the community, whether you are fixing a CLI bug, adding a new command, improving verification heuristics, or enhancing documentation.

> **Note**: This guide is for developers contributing code directly to this CLI repository. You do not need to run `asdlc new` or follow a multi-stage spec process to contribute here—standard, straightforward GitHub Pull Requests are used.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Repository Structure](#repository-structure)
- [Development Setup](#development-setup)
  - [Prerequisites](#prerequisites)
  - [Getting the Code](#getting-the-code)
  - [Local Testing & Debugging](#local-testing--debugging)
- [Engineering Guidelines & Invariants](#engineering-guidelines--invariants)
  - [1. Zero-Config & Convention over Configuration](#1-zero-config--convention-over-configuration)
  - [2. Minimal Dependencies](#2-minimal-dependencies)
  - [3. Cross-Platform Compatibility (Windows, macOS, Linux)](#3-cross-platform-compatibility-windows-macos-linux)
  - [4. Test-Driven Changes](#4-test-driven-changes)
  - [5. Bundled Skills Parity](#5-bundled-skills-parity)
- [Submitting a Pull Request](#submitting-a-pull-request)
  - [Commit Message Conventions](#commit-message-conventions)
  - [PR Checklist](#pr-checklist)
- [Licensing](#licensing)

---

## Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free environment for everyone. Please be respectful, constructive, and collaborative in all discussions, issues, and code reviews.

---

## Repository Structure

Understanding where things live in the repository:

```text
agentic-sdlc/
├── bin/
│   └── asdlc.js              # Executable CLI entrypoint (#!/usr/bin/env node)
├── src/
│   ├── commands/             # CLI command implementations (new, apply, verify, init, doctor, etc.)
│   ├── lib/                  # Reusable governance core (risk.js, level.js, git.js, fs.js, etc.)
│   └── index.js              # Programmatic export
├── assets/                   # Bundled templates and assets distributed with the package
│   ├── schema/               # Built-in OpenSpec schemas
│   ├── skills/               # Bundled agent skills (.md definitions)
│   └── githooks/             # Standard git hook templates
├── .agents/skills/           # Repository's local agent skills mirror (must stay in parity with assets/skills)
├── test/                     # Automated unit and integration tests (node:test)
├── CONTRIBUTING.md           # This guide
├── LICENSE                   # Apache 2.0 License
├── NOTICE                    # Copyright & attribution notice
└── README.md                 # Project overview and documentation
```

---

## Development Setup

### Prerequisites

- **Node.js**: `>= 20.19.0` (Native ES Modules required)
- **Git**: `>= 2.30.0`
- **npm**: `>= 10.0.0`

### Getting the Code

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/agentic-sdlc.git
   cd agentic-sdlc
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```

### Local Testing & Debugging

We rely on Node.js's native test runner (`node --test`). No third-party test runners are needed:

- **Run the full test suite**:
  ```bash
  npm test
  ```
- **Run a specific test file**:
  ```bash
  node --test test/risk.test.js
  node --test test/level.test.js
  node --test test/verify.test.js
  ```
- **Run the CLI directly from source**:
  ```bash
  node bin/asdlc.js --help
  node bin/asdlc.js status
  node bin/asdlc.js doctor
  ```

---

## Engineering Guidelines & Invariants

When contributing code to this CLI, please adhere to these core architectural invariants:

### 1. Zero-Config & Convention over Configuration
Avoid introducing complex configuration files for the CLI unless strictly necessary. Built-in, sensible defaults and deterministic conventions (such as standard change directories and built-in risk evaluation heuristics in `src/lib/risk.js`) should always take precedence over sprawling config options.

### 2. Minimal Dependencies
The CLI is designed to be lightweight, fast, and secure. We intentionally keep runtime dependencies to an absolute minimum (`commander` for CLI parsing and `yaml` for YAML handling). Think twice before introducing any external npm package.

### 3. Cross-Platform Compatibility (Windows, macOS, Linux)
The CLI runs in diverse environments across enterprise developer machines and CI runners:
- Normalize file paths using POSIX forward slashes (`/`) when processing paths or matching regex.
- When working with files and temporary directories, protect against transient file locks on Windows (`EBUSY` / `EPERM`) using retry loops (see `copyTree` and `removeDir` in `src/lib/fs.js`).
- Never rely on POSIX-only shell utilities (like `grep`, `awk`, `sed`, or `/dev/null`) inside Node.js scripts.

### 4. Test-Driven Changes
- Any bug fix, refactoring, or new CLI command must be accompanied by automated unit or integration tests in `test/`.
- Tests should clean up their temporary files in `finally` blocks or using unique temp directories.

### 5. Bundled Skills Parity
- Out-of-the-box agent skills are located in `assets/skills/<skill-name>/SKILL.md` and mirrored in `.agents/skills/<skill-name>/SKILL.md`.
- **Strict Invariant**: Any change to a skill must update both copies simultaneously so that they remain **100% byte-for-byte identical**. CI will fail if parity is broken.

---

## Submitting a Pull Request

1. **Create a topic branch**:
   ```bash
   git checkout -b fix/windows-file-lock
   # or
   git checkout -b feat/add-json-output-flag
   ```
2. **Make your changes** and add relevant tests.
3. **Verify locally**:
   ```bash
   npm test
   npm run lint
   ```
   Ensure all tests pass and there are no syntax issues.
4. **Commit your changes** following [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` New CLI command or functional capability
   - `fix:` Bug fix or error handling improvement
   - `docs:` Documentation updates
   - `test:` Adding or refining test suites
   - `refactor:` Code restructuring without functional behavior changes
   - `chore:` Dependency or build updates

   *Example*:
   ```bash
   git commit -m "feat(risk): add destructive DDL detection to assessment engine"
   ```
5. **Push and open a Pull Request**:
   Push to your fork and open a PR against the `main` branch of `akjamie/agentic-sdlc`. Describe the rationale behind the change and any testing details.

---

## Licensing

`agentic-sdlc` is licensed under the [Apache License, Version 2.0](LICENSE). By contributing to this repository, you agree that your contributions will be licensed under the terms of the Apache 2.0 License. See the [NOTICE](NOTICE) file for copyright details.
