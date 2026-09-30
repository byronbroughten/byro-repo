# Type modeling: reasoning and examples

Disclosed from [`docs/code-style.md`](../code-style.md), "Type modeling". The rules are there, one line each; this file holds the why.

## `interface` or `type`

Unions, `keyof`, mapped types and utility types are `type`s. A plain object shape is an `interface`, which lint enforces, so props and state bags can chain through `extends`.

## Two-letter generic params

Each abbreviation is usually constrained with `extends <DomainType>`. Bare `T`/`K`/`V`/`O` belong to domain-free utilities.

Two letters, not one, even where one would be unambiguous: a lone `F` or `I` reads as a bare letter rather than an abbreviation.

## Specificity over branded fallbacks

A branded fallback string also stops working, without any error, in constraint position: the intersection that satisfies the parent's constraint collapses it back to `never`.

## Lookup tables are keyed by the producer's union

A formatter once dispatched on a `switch` over the keys of an external `Request` type, whose every member is optional, ending in a `default` that printed raw JSON. The builders returned that same wide type, so nothing tied the kinds they produced to the cases the switch handled: a new kind compiled and silently rendered as JSON. The fix names the kinds on the producer side (a `RequestVerb` union next to the builders), types the builders to return only the modeled request, and annotates the formatter table with a mapped type over that union, so a missing or mistyped formatter fails `tsc`. The `default` survives only for requests the project doesn't build. Let the type, not the reader, carry the list of keys. The general hazard: a `default` over an optional-keyed type like `Request` compiles with any case missing.

## Use the named type that already exists

A field, return type or param bag that matches a named type uses it: `TableIdentity`, not `{ tableId: string; name: string }`.

