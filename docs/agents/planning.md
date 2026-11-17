# Design and grilling

Specs are [`specs.md`](./specs.md)'s, tickets [`tickets.md`](./tickets.md)'s and handoffs [`handoffs.md`](./handoffs.md)'s.

- **During design or grilling, write only `GLOSSARY.md` entries**, as each term is resolved, and an ADR the developer said yes to; everything else waits until the user invokes the skill that files it. Approving a design does not approve publishing it. Reads are fine, and a subagent can do them ([`delegation.md`](./delegation.md)).
- **No grill asks how the work splits into specs, Phases, tickets or sessions, nor in what order**; `/project-spec` and `/project-tickets` decide that. A grill records a fact a gate would rest on, such as "X has to be tried in real use before Y", only when the developer raises it.