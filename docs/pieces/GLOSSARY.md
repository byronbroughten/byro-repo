# Writing

Reader-facing prose the developer writes with an agent: one spec per work, grilled and filed as a GitHub issue. The words below are what specs and comments call the parts of that work.

## Language

**Piece**:
One work written for a reader, as a letter or a blog post. Each Piece gets its own spec, which names its Evidence and Formality values, or Academic, as [`writing-voice.md`](../writing-voice.md) defines them under Axes.
_Avoid_: draft, article, document

**Deliverable**:
The Google Doc a Piece is delivered in, and where the developer edits it.
_Avoid_: output, final copy

**Section**:
The part of a Piece under one H2 in its Deliverable, or under an H1 before that H1's first H2. A Section is named by its **heading path**: its H1's text, then its H2's, written `<H1> › <H2>`. A Section under an H1 alone is named by the H1, and one in a Deliverable with no H1 by its H2. A split Piece gives each sub-issue one or more Sections.
_Avoid_: chunk, part

**Outline**:
The spec's list of a Piece's Sections in order, each with its claim in one line and the facts it sets out in full, and nothing more.
_Avoid_: plan, structure, skeleton

**Stage**:
One kind of sub-issue a Piece is worked in: Research, Sections, the Final pass, a Whole draft or the Edit gate.
_Avoid_: phase, step

**Agent draft**:
The Markdown file of a Piece's Sections as agents draft them, kept in the repo that files the Piece's spec. Agents draft in it, a push writes it into the Deliverable, and `/revise-workflows`' pair mode compares it with the edited Deliverable. A Section the developer wrote is marked as theirs. It is never edited by hand.
_Avoid_: Snapshot, AI copy, draft (alone)

**Image placeholder**:
The paragraph in an Agent draft that stands where an image goes in the Deliverable. It names the image's file beside the Agent draft, or, for an image with no file, lists the facts the image shows.
_Avoid_: image stand-in, figure marker, placeholder (alone)

**Edit gate**:
The developer's ticket to edit the Deliverable, which an Interactive session closes out with `/close-project` on its spec.
_Avoid_: review ticket, judgement ticket, human gate

**Reference**:
A work the Piece credits for a borrowed fact or words. In an academic Piece, each Reference is an entry on its References page.
_Avoid_: source, citation, cited work

**Supporting Material**:
A file the spec names by its Drive file ID for the agent to read but not credit, as a rubric, an earlier letter or a sample of the voice. One file can be both Supporting Material and a Reference.
_Avoid_: source, input, background, example, template
