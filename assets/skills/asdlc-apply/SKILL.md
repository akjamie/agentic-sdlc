---
name: asdlc-apply
description: "Execute Stage 5 of Agentic SDLC: guard verification followed by strict task-level TDD loop (Red -> Green -> Refactor -> Evidence -> Converge) from tasks.md."
---

# /asdlc:apply - Task-Level TDD Implementation Engine

This skill executes **Stage 5 (Apply)** of the Agentic SDLC. It enforces strict task-level Test-Driven Development (TDD) and the Converge protocol.

---

## The TDD Principle

> **No production code is written without a prior failing test.**
> Marking a task complete without captured test evidence is a verification blocker.

---

## Workflow Sequence

### Step 1: Run the Apply Guard (Pre-Implementation Security Check)
Before editing any implementation or test code, run the apply guard:

```powershell
asdlc apply <CHANGE_ID>
```

`asdlc apply` deterministically verifies four cryptographic preconditions:
1. **Target Branch Approved Commit (`approvedSha`)**: Confirms that a commit touching the locked paths (`proposal.md` and `specs/**`) is physically merged into the target branch (`main` or `origin/main`).
2. **Change State Machine (`ready_for_impl`)**: Confirms `.openspec.yaml` has been transitioned to `status: ready_for_impl` (via `asdlc approve <ID>`).
3. **Spec Fingerprint Integrity (`specSha`)**: Verifies that the declared `specSha` in `.openspec.yaml` exactly matches the `approvedSha` on the protected branch.
4. **Working Tree Tamper Defense**: Ensures that locked spec files (`proposal.md`, `specs/**`) have no uncommitted local modifications.

- If `asdlc apply` fails: **STOP immediately**. Follow the provided hint (e.g. merge Spec PR or run `asdlc approve`).
- If `asdlc apply` succeeds: Proceed to Step 2.

### Step 2: Read `tasks.md` and Ground Context
1. Open and read `openspec/changes/<CHANGE_ID>/tasks.md`.
2. Inspect the spec requirements in `openspec/changes/<CHANGE_ID>/specs/**/*.md` to understand the acceptance criteria (`AC<n>`) and required test mappings (`(test: <path>)`).
3. Identify the next unchecked task (`- [ ]`).

### Step 3: The Task-Level TDD Loop (Per Task)

For every task in `tasks.md`, execute this exact 5-phase loop:

#### Phase A: RED (Write the Failing Test)
1. Write or expand the unit/integration test in the target test file.
2. Run the repository test command (e.g., `npm test`, `pytest`, `go test`).
3. **Assert Failure:** Verify that the test fails for the *expected* reason (e.g., function not found, assertion mismatched).
4. If the test passes before implementation: the test is invalid or redundant. Fix the test until it accurately tests the unwritten feature.

#### Phase B: GREEN (Implement the Minimum Code)
1. Implement the minimal code required to satisfy the failing test.
2. Do not write anticipatory code or unrequested abstractions.
3. Run the test command again.
4. **Assert Pass:** Verify that the test now passes cleanly (`Exit Code: 0`).

#### Phase C: REFACTOR & CONVERGE
1. Clean up implementation, adhere to repo standards, remove dead code.
2. Re-run all existing tests to ensure no regressions.
3. **Converge Protocol:** If reality disagrees with the spec during implementation:
   - **Type A (Implementation error):** Write reproducing test, append fix task, remain in PR.
   - **Type B (Missing test):** Add missing test, remain in PR.
   - **Type C (Spec gap/conflict):** **STOP**. Never silently edit locked spec files (`proposal.md`, `specs/**`). Report `SPEC_GAP` to the user and approver.

#### Phase D: Record Evidence & Check Box
1. Under the completed task in `tasks.md`, record the test run command and output:
   ```markdown
   - [x] 1.1 [TEST] Add failing test for AC1 (`test/feature.test.js`)
     - verify: `npm test` -> PASS (test/feature.test.js: 3 passed)
   - [x] 1.2 [IMPL] Implement minimal code for AC1
     - evidence: `npm test` -> PASS (all 35 passed)
   ```
2. Mark the checkbox `- [x]`.

---

### Step 4: Run Verification Gate
Once all tasks in `tasks.md` are checked and evidenced, run `asdlc verify`:

```powershell
asdlc verify <CHANGE_ID>
```

Verify that all checks pass:
- `approved-spec`
- `flow-state`
- `tasks-complete`
- `test-presence` (diff contains tests alongside source code)
- `tdd-evidence` (tasks have valid verification statements/evidence)
- `BDD + acceptance criteria`
- `openspec-validate`
