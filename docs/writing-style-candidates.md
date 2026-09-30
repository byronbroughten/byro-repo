# Writing-style candidates

Candidate rules for the developer's writing voice, drawn from the 24 Docs and 3 decks (speaker notes included) in the Drive folder Business Writing Examples.
Each candidate has a one-line rule, a tag (**voice** or **academic**), a short quoted instance and its source; strike or reword any of them.
#172 builds `docs/writing-style.md` and `docs/academic-writing-style.md` from the survivors, then deletes this file.

## How to review

- **Strike** a candidate by deleting it, **reword** it in place, or change its tag. Anything left standing becomes a rule in #172.
- **Seen in** counts the six reading batches (below) that reported the habit, out of 6. Several samples reuse whole paragraphs from one another (the DealLab script and the marketing plan; the D.R. Horton reports; Capital Budgeting and the ABC deck), so a count can overstate an independent habit.
- **Flag: rubric?** marks a habit an assignment rubric may have forced on you. **DealLab conflict** marks a candidate where the DealLab deck and the academic samples disagree. The candidate follows the deck and says what the other samples do.
- Citation inconsistencies were dropped, not made into rules. APA 7 is the academic sheet's standard instead (see [Dropped](#dropped)).

## Sources read

| Batch | Source | Genre |
| --- | --- | --- |
| 1 | DealLab - Brand Presentation (deck, slides and speaker notes) | Product marketing plan, slide script |
| 1 | Leadership Through Storytelling (deck, slides and speaker notes) | Spoken slide script with a personal story |
| 2 | Paylocity - Strategic Analysis and Recommendations.pptx (deck, slides and speaker notes) | Slide script |
| 2 | BB - Business and Corporate Strategies for Paylocity | Report |
| 2 | BB - Stratigic Analysis and Recommendations for Paylocity | Report |
| 3 | Assessment 4 - Code of Ethics and Business Conduct | Report. Despite the title, it is a financial plan for a property-management venture |
| 3 | Assessment 3 - Code of Ethics and Business Conduct | Report |
| 3 | Assessment 2 - Feasibility and Competetive Analysis | Report |
| 3 | Assessment 1 - Business Types and Plans | Report and personal plan |
| 3 | Assessment 3 (Wild Dog Coffee supply chain) | Slide script |
| 3 | MBA Leadership Class - Week 6 Assignment | Reflection |
| 3 | MBA Leadership Class - Week 3 Assignment | Case analysis |
| 4 | Assessment 2 - Wild Dog Demand Management Plan | Operations report |
| 4 | Assessment 3 - ABC Healthcare PPT | Slide script |
| 4 | Assessment 2 - Capital Budgeting Tools | Evaluation report |
| 4 | Assessment 4 - Accounting | Investment analysis |
| 4 | Assessment 3 - Accounting | Executive summary |
| 5 | Assessment 2 - Florida's Best Pickles PowerPoint | Slide script |
| 5 | Assessment 2 - Florida's Best Pickles Report | Recommendation report |
| 5 | Assessment 1 - Urban Outfitters Training Manual | Instructional manual |
| 5 | Assessment 4 - Stock Data Presentation | Slide script |
| 5 | Assessment 2 - 2 Year Stock Data Report | Analytical report |
| 5 | Assessment 3 - 10 Year Stock Data Report | Analytical report |
| 5 | Assessment 1 - Contextual Data Presentation | Slide script |
| 6 | Assessment 1 - Information and Marketing Strategy | Marketing plan |
| 6 | Assessment 3 - Digital Marketing Plan | Marketing plan |
| 6 | Assessment 2 - Brand Presentation | Slide script. It is the written script behind the DealLab deck, so it counts as product voice |

Every source read in full. The three decks' speaker notes were extracted from each `.pptx` (`ppt/notesSlides/*.xml`), since the Drive text extractor skips them.

## Voice candidates

### Numbers and evidence

- **V1. After a figure, say in the next sentence what it means for the reader ("This means…", "This would equate to…", "meaning…").** voice
  - "This would equate to about $40,000 per year in revenue" — DealLab - Brand Presentation
  - Seen in 5 of 6.
- **V2. Show the arithmetic step by step in prose, then state the total in its own short sentence.** voice
  - "That input multiplied by the slope is 1064.54, and that plus the y-intercept is 1252.76." — Assessment 2 - Wild Dog Demand Management Plan
  - "In total, that amounts to $534 for the broker's license." — Assessment 4 - Code of Ethics and Business Conduct
  - Seen in 4 of 6.
- **V3. State the assumption behind a projection inline, and call it conservative when it is.** voice
  - "Given a conservative conversion rate of 3% for free-to-paid users" — DealLab - Brand Presentation
  - Seen in 2 of 6.
- **V4. Give the exact figure, then a rounded, human-scale equivalent.** voice
  - "the project would effectively pay for itself in not much longer than one year and four months (1.36 years)" — Assessment 2 - Capital Budgeting Tools
  - Seen in 1 of 6 (all five of its sources).
- **V5. Write numbers as numerals with $ and %, and ranges with a hyphen.** voice
  - "$22-24 per hour for 40 hours per week ($45,760-$49,920 per year)" — Assessment 4 - Code of Ethics and Business Conduct
  - Seen in 1 of 6.
- **V6. Make a caveat specific: say how far off, or in which range, not just "may be inaccurate".** voice
  - "the model should be treated as less reliable when the inputted advertising spending is… substantially lower than $1,000" — Assessment 2 - Wild Dog Demand Management Plan
  - Seen in 1 of 6.
- **V7. State a target as a number, a deadline and the reason for the number.** voice
  - "within the first six months of launch, get at least 4,000 users to try the app for free" — DealLab - Brand Presentation
  - Seen in 1 of 6. Flag: rubric? (the course taught SMART objectives)
- **V8. Name the data's limits, and the specific data that would fix them.** voice
  - "Additional datasets that would increase the efficacy of analysis include those for mortgage interest rates, home sales prices" — Assessment 3 - 10 Year Stock Data Report
  - Seen in 1 of 6. Flag: rubric? (a limitations slide was required)

### Explaining

- **V9. Make an abstract point concrete at once with "For example," and an everyday scenario with real nouns.** voice
  - "For example, users can break down monthly utility costs into water, heat, electricity, garbage, etc." — DealLab - Brand Presentation
  - Seen in 6 of 6.
- **V10. Explain an unfamiliar idea by comparing it to something the reader already knows.** voice
  - "The app captures the power of Microsoft Excel spreadsheets by allowing users to enter input variables" — DealLab - Brand Presentation
  - "consider two people who each won $10,000, the only difference being that one of them was paid out instantly" — Assessment 2 - Capital Budgeting Tools
  - Seen in 2 of 6.
- **V11. Restate a dense or technical point in plain words with "In other words,".** voice
  - "In other words, despite selling more goods, the company became less efficient at selling them." — Assessment 3 - Accounting
  - Seen in 3 of 6.
- **V12. Spell out an acronym on first use with the short form in parentheses, then use only the short form.** voice
  - "BRRRR (Buy, Rehab, Rent, Refinance, Repeat) deals" — Assessment 1 - Information and Marketing Strategy
  - Seen in 5 of 6.
- **V13. Gloss a term inline with "i.e.," rather than in a separate sentence.** voice
  - "weighted average cost of capital (WACC), i.e., the average, weighted interest rate on the money needed to get a project off the ground" — Assessment 2 - Capital Budgeting Tools
  - Seen in 4 of 6.
- **V14. Before the real answer, name the tempting wrong reading and correct it.** voice
  - "On its face, Super Deals' offer looks like it would result in our losing money on each case sold to them. That interpretation is incorrect, however." — Assessment 2 - Florida's Best Pickles Report
  - Seen in 2 of 6.
- **V15. Back a claim with an explicit reason: "After all," or "That's because".** voice
  - "After all, if the ROI of a project does not outperform its WACC, the project is unsustainable" — Assessment 2 - Capital Budgeting Tools
  - Seen in 1 of 6.
- **V16. Put a cause-and-effect pair before the principle it supports.** voice
  - "If there is no trust, then people waste time monitoring what others are doing rather than completing their own work." — Leadership Through Storytelling
  - Seen in 1 of 6.

### Describing the product

- **V17. Describe features by what the user does ("Users can…"), not by what the system is.** voice
  - "Users can compare deals and scenarios side-by-side" — DealLab - Brand Presentation
  - Seen in 2 of 6.
- **V18. Introduce a feature as a label, a colon, and one or two sentences on what it does.** voice
  - "Reusable components: The app allows users to save components of deals, such as properties, loans, and expenditure lists" — DealLab - Brand Presentation
  - Seen in 2 of 6. Flag: rubric? (partly the slide-to-notes format)
- **V19. Say plainly where the product falls short of a competitor, without spin.** voice
  - "DealCheck offers graphs that illustrate projections of financial metrics over time, whereas DealLab only offers single-number metrics." — DealLab - Brand Presentation
  - Seen in 2 of 6.
- **V20. Open with the concrete backstory that led to the product, then name it.** voice
  - "After years of procuring physical properties and renting units to tenants, Property Science is introducing a new product, DealLab" — Assessment 2 - Brand Presentation
  - Seen in 1 of 6.
- **V21. Lean on the product's value words: precise, intuitive, modern, flexible, minimal data entry.** voice
  - "precisely and intuitively analyze deals with minimal data entry" — DealLab - Brand Presentation
  - Seen in 2 of 6.

### Confidence and candor

- **V22. Hedge only predictions, causes and plans ("may", "could", "likely"), at most one hedge per claim; state facts, decisions and verdicts flatly.** voice
  - "DealLab's paid tier will be priced in the range of $10-$20 per month… DealLab may also offer the option" — Assessment 2 - Brand Presentation
  - "The risk of ZXY becoming financially insolvent as a result of this investment is low." — Assessment 4 - Accounting
  - Seen in 6 of 6. The report samples stack hedges ("could possibly", "at least in part"); the deck never does.
- **V23. Admit a weakness or limit in one flat clause, often with "however" or in a parenthetical.** voice
  - "The website's SEO is poor, however, and could be improved with a steady stream of blog posts" — DealLab - Brand Presentation
  - "(although, I failed to market it effectively)" — Assessment 1 - Business Types and Plans
  - Seen in 3 of 6.
- **V24. Weigh the upside and the risk of a point together ("On the one hand… On the other hand…").** voice
  - "On the other hand, increased difficulty in finding profitable real estate deals could also increase demand for analytical tools like DealLab." — Assessment 1 - Information and Marketing Strategy
  - Seen in 2 of 6. Flag: rubric? (PESTLE invites it, though it recurs outside PESTLE)
- **V25. Turn to a caveat or exception with "That said," or "Still,".** voice
  - "That said, the fact that Paylocity's offices are spread throughout the country limits its exposure to any one natural disaster" — Paylocity - Strategic Analysis and Recommendations.pptx
  - Seen in 3 of 6.

### Structure and recommendations

- **V26. Open a section with one sentence stating its claim, then support it.** voice
  - "Unlike the initial investment, monthly operating expenses can be substantial for PM companies." — Assessment 4 - Code of Ethics and Business Conduct
  - Seen in 2 of 6.
- **V27. State the recommendation early and flatly, then give the reasons.** voice
  - "In fact, we should accept the offer. To understand why, one need only understand the following set of concepts:" — Assessment 2 - Florida's Best Pickles Report
  - Seen in 2 of 6.
- **V28. Lay out each option's pros and cons, then eliminate options until the recommendation is left.** voice
  - "That narrows the choices to Project A or both Projects B and C simultaneously." — Assessment 2 - Capital Budgeting Tools
  - Seen in 1 of 6.
- **V29. Close with the recommendation plus the reasons that decided it, opened by "Given…", "For these reasons," or "Therefore,".** voice
  - "Given these considerations, it is clear that we should sell 2,000 cases of pickles to Super Deals this month" — Assessment 2 - Florida's Best Pickles PowerPoint
  - Seen in 3 of 6.
- **V30. Phrase advice to the subject as "should" or "would do well to", not a passive "it is recommended".** voice
  - "Paylocity would do well to keep their operations strictly in the US, at least until their market niche is saturated" — BB - Business and Corporate Strategies for Paylocity
  - Seen in 2 of 6. See also A4.
- **V31. Number parallel reasons in prose ("First, … Second, … And third, …") when each needs a sentence or more.** voice
  - "First, they are free. Second, they offer the ultimate freedom and customizability" — Assessment 1 - Information and Marketing Strategy
  - Seen in 5 of 6.
- **V32. Use bullets only for short parallel items (costs, features, slide points); keep reasoning in prose.** voice
  - "Savable and reusable deal components" (a slide bullet whose reasoning is in the notes) — DealLab - Brand Presentation
  - Seen in 3 of 6. Flag: rubric? (one rubric required slide bullets)
- **V33. Point back to an earlier finding by name, and end a section by pointing to what comes next.** voice
  - "This comes with a potential threat, however, which will be covered shortly." — Paylocity - Strategic Analysis and Recommendations.pptx
  - Seen in 1 of 6.
- **V34. Put a side point in its own "Note that…" sentence.** voice
  - "Also note that the discount rate can be increased to account for a project's heightened risk" — Assessment 3 - ABC Healthcare PPT
  - Seen in 2 of 6.

### Sentences and punctuation

- **V35. Let explanatory sentences run long, then land the point with a short, blunt one.** voice
  - "Paylocity focuses exclusively on serving businesses in the United States. From a risk standpoint, this makes sense." — BB - Business and Corporate Strategies for Paylocity
  - Seen in 3 of 6.
- **V36. Use paired em dashes for a mid-sentence aside or example list, and a single em dash to add the consequence.** voice
  - "Users input information about a potential deal—the offer price for a property, loan information, anticipated costs, etc.—and the app calculates" — Assessment 1 - Information and Marketing Strategy
  - Seen in 5 of 6.
- **V37. Put a colon after a verdict, then the explanation.** voice
  - "Paylocity is largely undiversified and from a corporate standpoint is a dominant business: its main driver of profit comes from the offerings of Paylocity itself" — Paylocity - Strategic Analysis and Recommendations.pptx
  - Seen in 1 of 6.
- **V38. End an open-ended list of everyday examples with "etc." or "and so on".** voice
  - "This can include items such as office technology, professional licenses, brand creation, and so on." — Assessment 4 - Code of Ethics and Business Conduct
  - Seen in 3 of 6.
- **V39. Link sentences with plain additive connectives: "Furthermore", "Moreover", "Additionally", "Finally".** voice
  - "Moreover, DealCheck is in an advantageous market position." — DealLab - Brand Presentation
  - Seen in 3 of 6. DealLab conflict: one batch tagged these academic; the deck uses them, so they stay voice. The rarer formal connectives go to A6.

### Person and register

- **V40. In product prose, name the product ("DealLab", "the app") and call the reader "users"; use no "we" for the company and no "you".** voice
  - "DealLab emphasizes detailed cost estimation by giving users the option to break down any category" — DealLab - Brand Presentation
  - Seen in 2 of 6. DealLab conflict: the deck never says "you" or "we". The Pickles pieces use an insider "we/our" ("each case has cost us about $10 to produce"), the spoken scripts use "we/let's", and Storytelling says "you". The rule follows the deck. In-app messages may still want "you", and the deck never shows in-app copy, so decide that case here.
- **V41. Use first person for first-hand experience ("I have done this at my own properties"), outside product prose.** voice
  - "Having done this multiple times for my own properties, I found that moving walls to make it happen can be both affordable and highly valuable" — Assessment 2 - Feasibility and Competetive Analysis
  - Seen in 2 of 6. DealLab conflict: the deck has no first person, so under V40 this applies only to prose written as the developer (blog posts, reflections).
- **V42. In spoken scripts, guide the listener with "we" and "let's" and mark each move ("We'll start with…", "Now that we have covered…").** voice
  - "Now that we have covered the relevant considerations of Wild Dog Coffee Company, let's talk about supply chains and logistics." — Assessment 3
  - Seen in 5 of 6. Flag: rubric? (the slide-script format was assigned). DealLab conflict: the deck's notes use none of this.
- **V43. Tell a personal story in first person and past tense, in short chronological beats, then state its moral.** voice
  - "The moral of the story is that teams change and leaders must remain vigilant to accommodate those changes." — Leadership Through Storytelling
  - Seen in 1 of 6.
- **V44. Don't use contractions.** voice
  - The DealLab deck has no contractions in about 2,900 words of slides and notes.
  - Seen in 2 of 6. DealLab conflict: the Paylocity pieces use them even in the formal reports ("isn't particularly special"), and so do Storytelling and the Week 6 reflection. The rule follows the deck; reword it if you meant the looser voice.
- **V45. Prefer plain words to Latinate ones ("show", not "corroborate"; "many", not "manifold").** voice
  - "Users can tailor the app to their needs" — DealLab - Brand Presentation
  - Seen in 3 of 6. DealLab conflict: the reports lean Latinate ("corroborate" about 10 times, "salient", "attenuates"); the deck does not. See A5.
- **V46. No humor; at most one light aside per piece, in quotes if it stretches a term ("so to speak").** voice
  - "DealLab's \"physical evidence\" so to speak will comprise its branding, presentation, and layout." — Assessment 2 - Brand Presentation
  - Seen in 4 of 6. DealLab conflict: the Paylocity and stock pieces allow more idioms ("nuts and bolts", "not for antsy investors who are faint of heart"). The rule follows the deck's restraint.

## Academic candidates

- **A1. Cite every borrowed fact with an (Author, Year) parenthetical.** academic
  - "Paylocity was sued by one of its clients for allegedly miscalculating staff hours and/or wages (Kasler, 2024)." — BB - Stratigic Analysis and Recommendations for Paylocity
  - Seen in 6 of 6. Only the habit of citing is kept; its format comes from APA 7, not the samples.
- **A2. Name the source in the sentence ("According to X (2025), …") when the source matters to the claim.** academic
  - "According to an IBISWorld report on homebuilders in the US (2025), most homebuilders are small and localized" — Assessment 3 - 10 Year Stock Data Report
  - Seen in 1 of 6.
- **A3. Write in impersonal third person ("this report", "one finds"); use "we" only as the narrator guiding the reader.** academic
  - "one finds that next month Wild Dog is forecasted to serve 431 espresso beverages per day on average." — Assessment 2 - Wild Dog Demand Management Plan
  - Seen in 5 of 6. Flag: rubric? (MBA reports expect a formal register)
- **A4. Put a formal recommendation in the passive: "it is recommended that…".** academic
  - "Therefore, it is recommended that ZXY move forward with its proposed investment." — Assessment 4 - Accounting
  - Seen in 3 of 6. Flag: rubric? It conflicts with V30, where the deck and spoken pieces say "should". Strike this if V30 should hold in academic work too.
- **A5. A formal, Latinate vocabulary is fine in academic work ("manifold", "salient", "pertinent").** academic
  - "Operating a business ethically has manifold benefits." — Assessment 3 - Code of Ethics and Business Conduct
  - Seen in 2 of 6. The voice sheet's V45 says the opposite for everything else.
- **A6. Link paragraphs with the formal connectives "Conversely", "albeit" and "To that end".** academic
  - "albeit with a proportional increase in cost of sales." — Assessment 2 - Capital Budgeting Tools
  - Seen in 1 of 6.
- **A7. Open with a purpose statement ("This report is to inform…"), then the organization, the decision at stake and a roadmap.** academic
  - "This report is to inform whether to grant the loan to Ace Company. To that end, the report summarizes and analyzes" — Assessment 3 - Accounting
  - Seen in 5 of 6. Flag: rubric? (a stock assignment intro). The "is to inform" wording recurs across courses, so it may be your own. The "In this paper I will…" form was dropped as rubric.
- **A8. Define a framework concept, with its citation, before applying it to the case.** academic
  - "a Blue Ocean strategy, which is the successful synthesis of cost leadership and differentiation via value innovation (Rothaermel, 2023)." — Paylocity - Strategic Analysis and Recommendations.pptx
  - Seen in 1 of 6. Flag: rubric? (assignments ask you to show framework knowledge)
- **A9. Before interpreting a chart, explain how it was built: axes, trend line, moving average.** academic
  - "To do this, each data point is summed with the 59 preceding data points (60 total) and then divided by 60." — Assessment 3 - 10 Year Stock Data Report
  - Seen in 1 of 6. Flag: rubric? (the rubric demanded that graphics be explained)
- **A10. End a subsection with a one-line summary of its takeaway.** academic
  - "In brief summary, Saint Paul further emphasizes equity and the rights of renters." — Assessment 3 - Code of Ethics and Business Conduct
  - Seen in 1 of 6.

## Dropped

- **Rubric structure**: title pages; the fixed Introduction, Conclusion, References and Appendix sections; appendices that repeat the body; headings that mirror a framework (SWOT, PESTLE, VRIO, Five Forces, SOSTAC, the 8Ps, SMART); mandated "Role of Leadership" and "Ethical responsibility" sections; slide counts; rubric notes still pasted into slide docs; "Summary of Key Points" recaps; conclusions that only restate the body; "In this paper I will… I will then…" roadmaps; the positioning-statement template; discussion-question slides and the formulaic thank-you sign-off.
- **Citation inconsistencies**: author names spelled two ways (Marshal and Marshall, Astrebo and Astebro); a source dated two ways (Rothaermel 2023 and 2025); one filer named three ways; reference entries that sometimes include "Retrieved from", a DOI or an ISSN and sometimes don't; in-text citations with no year; sources cited but missing from the reference list; a DealCheck reference that points to an unrelated URL; image credits on a References slide.
- **Noise**: typos ("Palocity", "SASS" for SaaS, "highlisted"), inconsistent brand spellings ("NerdWallet" and "Nerd Wallet"), "agency" used for "company" in one deck, and a factual slip ("28 day durations (two weeks)").
- **Too thin**: one-off metaphors (a supply chain as "a stream"), rhetorical questions (Week 3 only), a history told in short dated sentences (one passage reused across the D.R. Horton reports).
- **Workflow habits**: reusing whole paragraphs across assignments.
