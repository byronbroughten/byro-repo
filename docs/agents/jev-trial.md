# Jev trial log

How `npm run jev:style` compared with `/review-piece`'s Voice and Craft sub-agents on each Piece reviewed; the log counts their findings together as **Style findings**. It is the evidence for upgrading Jev's pin ([`jev.md`](./jev.md#the-pin-and-upgrading-it)).

**The trial is paused after writing#18**, where 0 of 50 Jev flags matched a Style finding; `/review-piece` no longer runs `jev:style`. That run has no row, since its disagreements were never ruled on.

**It never quotes Piece text: only counts, rule names and issue numbers.** This repo is public and Pieces are private.

## Columns

- **Issue**: the Piece's issue in `byronbroughten/personal`.
- **Jev pin**: the `jevPin` the run used.
- **Jev flags** and **Style findings**: each one's count for the scope reviewed.
- **Matches**: a Jev flag and a Style finding on the same paragraph and rule.
- **Jev misses** and **Jev extras**: the Style findings Jev didn't flag, and Jev's flags with no Style finding, each with the rules involved.
- **Rulings**: the developer's ruling on each disagreement, as counts for Jev and for Style, plus the rules each lost on.

## Log

| Issue | Jev pin | Jev flags | Style findings | Matches | Jev misses | Jev extras | Rulings |
| --- | --- | --- | --- | --- | --- | --- | --- |
| writing#5 | jev-1.13.0 | 89 (0 breaks, 89 unsure) | 11 | 3 (caveat specific) | 8 (spec override on definition sentences ×3; state a point plainly ×2; after a figure; make each point once; caveat turn) | 86 (cite in APA 7 ×29; impersonal third person ×15; subsection takeaway ×15; caveat specific ×11; numerals ×9; name the source ×5; cause-and-effect ×1; section opening ×1) | Jev lost 86 (every extra). Style lost 4: spec override ×3, caveat turn ×1. Style won 4: state a point plainly ×2, after a figure, make each point once. |
| writing#6 | jev-1.13.0 | 70 (0 breaks, 70 unsure) | 8 | 2 (subsection takeaway; section opening) | 6 (name not pronoun; make each point once; stock phrase reused; paired em dashes; hedge per claim; call it conservative) | 62 (cite in APA 7 ×30; impersonal third person ×12; subsection takeaway ×10; section opening ×8; acronym ×1; contractions ×1) | Jev lost 62 (every extra). Style won 5: name not pronoun, make each point once, stock phrase reused, paired em dashes, call it conservative. Style lost 1: hedge per claim. |
