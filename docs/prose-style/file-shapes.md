# File shapes

Why a rule line carries only the rule, why the reasoning sits one pointer away, and why a mechanics doc has a short lead and greppable headings.

## A rule line carries only the rule

A rules file is read in full before work starts, so every byte of it is paid on every task that reads it. A line that also carries its why or an example costs that much more and buries the rule. The convention replaced a 300-character cap, which became a target; the history is in [`agent-behavior-design.md`](../agent-behavior-design.md#put-each-rule-where-it-gets-followed-and-its-reasoning-one-pointer-away).

Before: **Name a value after the domain type it holds, because a generic word like `data` or `item` tells the reader nothing, as in `rows` over `items`.** After: **Name a value after the domain type it holds, not a generic container word.**, with the reason and the example in `config/docs/code-style/naming.md`.

## Reasoning one pointer away

A reasoning file is opened only when a rule's line doesn't decide the case, or when the rule is changing. Kept out of the rules file, it can hold every instance and its history without raising the cost of the read that everyone pays. The fixed sentence on when to open one is the same in every rules file, so an agent learns it once.

## Mechanics docs

A mechanics doc is read by heading, not whole. Its lead is what an agent reads to decide whether the doc is the right one, so it stays short; lint caps it in bytes as well as lines, since a line count lets one long paragraph through. A doc over 4 KB with no headings is one long lead read whole. A heading is how a grep finds the section, so "Notes" or "Details" finds nothing. A rule found in a mechanics doc is followed only by agents who happen to read that heading, so it moves up to where it's loaded.
