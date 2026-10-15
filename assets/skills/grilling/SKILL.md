---
name: grilling
description: "High-efficiency batch design-tree interview (batch-grill-me) for Stage 2 of Agentic SDLC. Asks every frontier question at once round by round with recommended defaults, dispatches non-blocking fact explorations, settles clarifications.md, and stops only when shared understanding is confirmed."
aliases:
  - batch-grill-me
  - grill-me
---

# Batch Grilling — Relentless Design-Tree Interview (`batch-grill-me`)

This skill drives the **Grilling phase** (Stage 2) of the Agentic SDLC. It operates between `asdlc new "<requirement>"` and spec authoring (`proposal.md` / `specs/**`). It can also be invoked standalone via `/batch-grill-me` or `/grill-me` for any architectural design.

Interview the author relentlessly until you reach a shared understanding. Map the requirement as a **design tree**: every decision branches into the decisions that hang off it.

---

## Core Protocol: The Decision Tree & The Frontier

1. **Work the tree in rounds.**
   The **Frontier** is every decision whose prerequisites are already settled — the questions you can ask now without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the author's answers before the next round.
2. **Dynamic Tree Reshaping.**
   Each round the author answers reshapes the tree — settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round.
3. **No Premature Speculation.**
   A question whose answer depends on another question still open in this round belongs to a later round, not this one. Never ask speculative downstream questions whose parent branches are unresolved.

---

## Fact-Finding vs. Human Decisions

1. **Finding facts is your job, never the user's.**
   When a frontier question needs a fact from the environment (filesystem, codebase AST, existing specs, tools, etc.), look it up yourself — don't ask the author for anything you could look up.
   - **Local Graphify AST / `explore.md`**: Query god nodes, call chains, and architectural hubs first.
   - **Workspace inspection**: Read source code, configuration files, and package manifests.
   - **Web search**: Only if `web_search: allow` in `.sdlc/policy.yaml` (default: allow).
2. **Non-blocking Fact Exploration.**
   When finding a fact requires deeper investigation:
   - If the agent harness supports sub-agents: **dispatch a sub-agent to find it**.
   - If single-agent harness: execute targeted search/read tools immediately.
   - **Do not block on it**: A running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report — **ask the rest of the frontier now**.
3. **Decisions belong to the human.**
   Architectural trade-offs, product boundaries, business rules, and error policies belong to the human. Never silently assume an answer. Put each to the author and wait.

---

## Termination Gate: Empty Frontier & Shared Understanding

The session is done when the **frontier is empty**:
- Every branch of the design tree has been visited.
- Nothing is left silently assumed.
- **Do not act on it until the author confirms you have reached a shared understanding** (e.g. by replying *"Approve all recommendations"* or signing off on the batch).
- Record all settled decisions in `openspec/changes/<SLUG>/clarifications.md` under `## Settled decisions`.
- Only then proceed to Stage 3: drafting `proposal.md` and `specs/**`.

---

## Batch Round Presentation Format

Format each round of the `batch-grill-me` interview strictly as follows:

```markdown
### 🎯 Batch Decision Frontier (Round <N>)

I have analyzed the codebase context in `explore.md` for requirement: **"<requirement>"**.
Here is the complete set of architectural and scoping decisions currently on the frontier:

---

❓ **Q1** - **<Decision Title>**:
<Concise explanation of the choice, architectural trade-offs, and available options (A / B / C)>

➡️ **Recommendation**: **Option A** — <Concrete rationale grounded in codebase facts / explore.md>

---

❓ **Q2** - **<Decision Title>**:
<Concise explanation and options>

➡️ **Recommendation**: **Option B** — <Concrete rationale>

---

❓ **Q3** - **<Decision Title>**:
<Concise explanation and options>

➡️ **Recommendation**: **Option A** — <Concrete rationale>

---

💡 *To proceed efficiently, you can reply **"Approve all recommendations"**, or specify adjustments (e.g. `Q1: B, Q2: accept`).*
```

---

## SDLC Artifact Synchronization

When operating inside an `asdlc` change (`openspec/changes/<SLUG>/`):

1. **Context Grounding**: Read `explore.md` (knowledge graph findings, call chains, god nodes) and `clarifications.md`.
2. **Frontier Extraction**: Identify all open architectural forks, boundary ambiguities, and error-handling strategies.
3. **Execute Batch Round**: Present the numbered question batch with recommended answers.
4. **Record Settled Decisions**: Record answers in `clarifications.md` under `## Settled decisions`:
   ```markdown
   ## Settled decisions

   - **<Decision 1 Title>**: <Chosen Option>
     - *Rationale*: <Why this was chosen>
   - **<Decision 2 Title>**: <Chosen Option>
     - *Rationale*: <Why this was chosen>
   ```
5. **Close & Hand-off**: When the frontier is empty and confirmed by the author, clear `## Open questions` and transition to authoring `proposal.md`, `specs/**`, and running `asdlc lint <SLUG>`.
