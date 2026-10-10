# Jev trial log

How `npm run jev:style` compared with `/review-piece`'s Style sub-agent on each Piece reviewed. It is the evidence for upgrading Jev's pin ([`jev.md`](./jev.md#the-pin-and-upgrading-it)).

**It never quotes Piece text: only counts, rule names and issue numbers.** This repo is public and Pieces are private.

## Columns

- **Issue**: the Piece's issue in `byronbroughten/writing`.
- **Jev pin**: the `jevPin` the run used.
- **Jev flags** and **Style findings**: each one's count for the scope reviewed.
- **Matches**: a Jev flag and a Style finding on the same paragraph and rule.
- **Jev misses** and **Jev extras**: the Style findings Jev didn't flag, and Jev's flags with no Style finding, each with the rules involved.
- **Rulings**: the developer's ruling on each disagreement, as counts for Jev and for Style, plus the rules each lost on.

## Log

| Issue | Jev pin | Jev flags | Style findings | Matches | Jev misses | Jev extras | Rulings |
| --- | --- | --- | --- | --- | --- | --- | --- |
