---
name: plan-project
description: "Start every planning session: pick the code or piece Workflow, or both, grill the developer on the work by each Workflow's branch file, and end by recommending /project-spec. Invoked as /plan-project [code] [piece]."
disable-model-invocation: true
---

Grill the developer on one Project before `/project-spec` files it. Each [Workflow](../../../runner/GLOSSARY.md#language) has a branch file: [`code.md`](./code.md) for code, [`piece.md`](./piece.md) for a Piece. **Read only the branch files of the Workflows you are grilling, together in one turn**, with [`docs/pieces/grilling.md`](../../../docs/pieces/grilling.md) for a piece grill. During the grill, write only what [`planning.md`](../../../docs/agents/planning.md) allows.

## 1. Pick the Workflow

- **The arguments name the Workflows**: `code`, `piece`, or both.
- **With no argument, pick the Workflow from the request, say which, and ask only when unsure.**
- **When the named Workflows look wrong for the work, say so and let the developer decide**: `piece` for work that needs a Sheet built by code, say.

## 2. Grill

One Workflow: follow its branch file. Both: **a combined grill is one design tree, opened by the piece's opening round and closed by the piece's ending**. `piece.md`'s steps 1 and 2 come first, asking for the Deliverable and Supporting Material and reading them; then `code.md`'s questions and `piece.md`'s step 3 rounds, in the order their answers need; then `piece.md`'s step 4, the calibration paragraph, Outline, Research and Final pass, last.

These rules bind every branch:

- **No grill asks how the work splits into specs, Phases, tickets or sessions, nor in what order**; `/project-spec` and `/project-tickets` decide that. Record a fact a gate would rest on, such as "X has to be tried in real use before Y", only when the developer raises it.
- **When the work changes a Workflow, ask the analogue question**: would an analogous change improve each other Workflow, by [the cross-Workflow rule](../../../docs/agents/workflows.md#a-change-to-one-workflow)? The spec records the answer: the change, or why it doesn't apply.
- **The read rules, for any sub-agent read**:
  - Sub-agents read the Deliverable, earlier specs and earlier graded work, as they read the Supporting Material.
  - **Each read report gives one fact per line with its locator, and quotes verbatim only the developer's own text a voice question needs.**
  - The main session reads a passage whole only when a question turns on its exact wording.

## 3. End

Done when each branch's done criterion holds. End by recommending `/project-spec`, naming the repo or repos that file the specs.
