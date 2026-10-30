# A principle may rest on one ADR, and a reasoning file holds only what no single ADR holds

ADR 0001 had each design principle cite at least two ADRs, but ADRs are rare, self-contained decisions that seldom make one argument, so the floor forced thin pairings. A principle may now rest on one ADR, and earns its line only by deciding cases its ADRs don't name, which takes over the floor's guard against platitudes. ADR 0001's other decisions stand.

A principle gets a reasoning file, or in `agent-behavior-design.md` an argument and instances under its heading, only for what no single ADR holds: the argument across several ADRs, or a citable case beyond its one ADR, such as an issue, a commit, a probe or a code site. Otherwise its line links its ADR directly, since a file that restated the ADR would drift from it.

Source: byronbroughten/byro-repo#377
