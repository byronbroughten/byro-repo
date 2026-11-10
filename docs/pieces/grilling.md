# Grilling a piece spec

A spec that holds only facts yields a draft that is accurate but flat, and the developer then rewrites it in their own voice. The grill puts the voice-bearing material into the spec first, by asking the questions below; `/grill-piece` runs it.

## Questions

The voice questions are the verdict, the stakes, a before and after, Temperature and Reach. Research, Final pass and Split wait on the approved Outline. Each example is from Piece A, a letter of support, unless it names another Piece by its letter.

- **The reader.** Who reads the Piece, what they already know, and which of the Piece's terms they use daily; a term not on that list gets glossed. It fills the spec's Reader field, which `/review-piece`'s Reader axis stands in for. (B: the professor, grading against the rubric, who has read the first draft.)
- **The verdict.** The strongest thing the developer would say, word for word, at full strength. It opens the Piece's main section. (A: "I can say without a doubt that Sam has more creativity and ingenuity than I have encountered in any other contractor.")
- **The stakes.** What the developer relies on the subject for, and what they would lose without it. (A: "His reliable quotes are the basis on which I decide whether or not to invest in properties.")
- **A before and after.** One change the developer saw, with each side described concretely. (A: "the dingy, rundown space … into the warm, welcoming home")
- **Missing facts.** Read the fact list back and ask what is missing; the developer's memory holds facts no Supporting Material does. (A added chimney repairs, the first duplex and the home bought this year.)
- **Your own text.** Which of the developer's own words the Piece keeps or revises: an earlier draft, the rewritten calibration paragraph, Supporting Material already graded. The spec's Facts field names each as given, so the review doesn't flag it as untraced. (B: the graded draft, whose sentences may be reused or revised.)
- **Long reads.** Which Supporting Material or References are too long to read whole, such as a book or a lender's selling guide, and which page ranges or sections count. The spec lists them, so agents read only those passages. (B: a standards guide and a textbook.)
- **The cut order.** Which listed facts go first when space runs short. (A cut the water heater and both tenant anecdotes.)
- **What stays out.** Facts that are true and relevant but that the developer won't put in the Piece at any length, and what, if anything, stands in for them. (B: "Let's leave out the LLC transfer stuff and just say I'm working on the HELOC thing in the fall.")
- **Funding sources.** For each budget or cost figure, which sources pay for it and in what share; a single named source reads as the whole. (C: the new HELOC funds only part of the $N budget, and cash reserves the rest: "some of which will come from a new HELOC with Example Credit Union")
- **The depth.** For each section, which criterion it answers and how much support that criterion needs, counted in paragraphs, lists, tables and figures, never in words, because a word count becomes a target the draft writes to. Support beyond that is cut, however true; a rubric word such as "comprehensive" is not by itself a reason to add more. (C: "The schedule leaves little slack…", the price-sensitivity paragraph and a cited author's combinable-approaches point were drafted, then cut.)
- **Evidence.** One value from [`writing-voice.md`](../writing-voice.md)'s Axes: `firsthand`, `sourced` or `cited`. (A dropped a citation as too academic: `firsthand`.)
- **Formality.** `general` or `formal`, from the same Axes. An Academic Piece answers both questions at once. The spec records the answers on one line: `Evidence: firsthand · Formality: formal`, or `Academic`.
- **Temperature.** A flat record or warm testimony. An override such as "flat statements of fact" reads as clipped unless the spec says how warm. (A wanted warm.)
- **Reach.** How far the closing claim or ask extends. (A: "in the city, around the metro area, and across the state.")
- **Research.** Whether any source, page range or fact needs checking before drafting, and which; a claim with no source yet counts. Every source is a Drive file; a web page is saved as a Doc during the grill, by `/grill-piece`'s Saving a web page. (D: unchecked page ranges in the standards guide, a source for lesson 3, and whether a second author belongs in the textbook's reference.)
- **Final pass.** Whether the whole Deliverable needs a last pass, and what it covers. (D: the AI Usage section, References, table and figure numbering, the APA and rubric checks, and `npm run overlap`.)
- **Split.** One session, or the Outline's Sections grouped into sessions, each named by its heading text. (D: Research, two groups of Sections, then the final pass, with the developer's Figure 1 upload partway through the second.)
