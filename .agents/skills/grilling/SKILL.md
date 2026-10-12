---
name: grilling
description: "High-efficiency batch design-tree interview (batch-grill-me) for Stage 2 of Agentic SDLC. Evaluates the full decision frontier, presents structured question batches with default recommendations, and settles clarifications.md in 1-2 rounds."
---

# Batch Grilling - High-Efficiency Design-Tree Interview (`batch-grill-me`)

This skill drives the **Grilling phase** (Stage 2) of the Agentic SDLC. It operates between `asdlc new "<requirement>"` and spec authoring (`proposal.md` / `specs/**`).

To maximize agent and author efficiency, this skill strictly uses the **`batch-grill-me` protocol**: never ask single sequential questions in ping-pong turns; compute and present the **entire decision frontier in structured batches** with default recommendations.

---

## Core Principles

1. **The Human decides, the Agent looks up facts.**
   - Finding facts is the agent's job. Use the following priority order (auto-fallback, no CLI flags needed):
     1. **Graphify AST graph** — local, always available. Query god-nodes and call chains first.
     2. **Direct project file/code reading** — local, always available.
     3. **Web search** — only if `web_search: allow` in `.sdlc/policy.yaml` (default). In air-gapped or restricted networks, set `web_search: deny`; the agent skips search entirely without any flag.
   - If a fact cannot be verified via any available tier, mark the question `[fact unverified — author to confirm]` rather than blocking the round.
   - Architectural tradeoffs, product boundaries, and business choices belong to the human. Never silently assume an answer.
2. **Batch Frontier Evaluation (`batch-grill-me`).**
   - Every design decision branches into subsequent dependent decisions.
   - The **Frontier** is the set of all open decisions whose prerequisites are already settled.
   - In each round: evaluate the entire frontier and present **all independent decisions together in one structured batch** (`Q1`, `Q2`, `Q3`...).
   - Every question MUST provide a concrete, fact-backed **recommended default** so the human can review and approve in a single response.
3. **1-2 Turn Convergence.**
   - Instead of 10+ sequential conversational turns, the goal is settling the full decision tree in **1 to 2 batch rounds**:
     - **Turn 1**: Present full initial decision frontier batch.
     - **Human Response**: The author can reply `"Accept all recommendations"` or provide targeted overrides (e.g., `"Q1: B, Q2: accept, Q3: custom..."`).
     - **Turn 2 (if needed)**: Present any newly unblocked child decisions unblocked by Round 1 overrides.
4. **Record Settled Decisions in `clarifications.md`.**
   - Record every agreed decision under `## Settled decisions` (Decision -> Choice -> Rationale).
   - Once all questions are resolved, ensure `## Open questions` is empty and proceed to author `proposal.md` -> `specs/**`.

---

## Batch Round Format

Format each round of the `batch-grill-me` interview strictly as follows:

```markdown
### 🎯 Batch Decision Frontier (Round 1)

I have analyzed the codebase context in `explore.md` for requirement: **"<requirement>"**.
Here is the complete set of architectural and scoping decisions on the frontier:

---

❓ **Q1** - **<Decision Title>**:
<Concise explanation of the choice, architectural trade-offs, and available options (A / B / C)>

➡️ **Recommendation**: **Option A** — <Rationale grounded in codebase AST / architectural pattern from explore.md>

---

❓ **Q2** - **<Decision Title>**:
<Concise explanation and options>

➡️ **Recommendation**: **Option B** — <Rationale>

---

❓ **Q3** - **<Decision Title>**:
<Concise explanation and options>

➡️ **Recommendation**: **Option A** — <Rationale>

---

💡 *To proceed efficiently, you can reply **"Approve all recommendations"**, or specify adjustments (e.g. `Q1: B, Q2: accept`).*
```

---

## Workflow Sequence

1. **Context Grounding**: Read `explore.md` (knowledge graph findings, call chains, god nodes) and `clarifications.md` in `openspec/changes/<SLUG>/`.
2. **Frontier Extraction**: Identify all open architectural forks, boundary ambiguities, and error-handling strategies.
3. **Execute Batch Round**: Present the numbered question batch with recommended answers.
4. **Record Settled Decisions**: Record answers in `clarifications.md` under `## Settled decisions`.
5. **Close & Hand-off**: When the frontier is exhausted, mark clarifications complete and proceed to author `proposal.md`, `specs/**`, and `review.md`.
