---
name: file-issue
description: Load the ticket rules before filing an issue or putting a ready label on one by hand, outside /project-tickets and /project-spec.
allowed-tools: Bash(npm run doc:sections *)
---

The ticket rules from [`tickets.md`](../../../docs/agents/tickets.md), their home:

!`npm run doc:sections -- docs/agents/tickets.md Where "Model fit"`

- **File through `npm run issue:file`**, each ticket a draft opening with its front matter ([the issue tracker doc](../../../docs/agents/issue-tracker.md#file-tickets-from-drafts)).
- **Put a `ready-*` label on through `npm run issue:ready -- <repo> <n> <label>`**, never `gh issue edit`.
- **A split, or work that fails [the ticket split test](../../../docs/agents/tickets.md#the-ticket-split-test), follows [`/project-tickets`](../project-tickets/SKILL.md); a spec follows [`/project-spec`](../project-spec/SKILL.md)**, each read as a file, since both are user-invoked.
