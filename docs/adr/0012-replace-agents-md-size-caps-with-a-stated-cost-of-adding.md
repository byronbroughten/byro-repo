# Replace AGENTS.md size caps with a stated cost of adding

The 5 KB cap on the root AGENTS.md and the line limits on nested ones acted as targets: an agent 2 bytes under the cap left the file alone and spread a pointer over three other files. The lint no longer counts AGENTS.md bytes or lines. `prose-files.md` states what an addition costs instead, and a hook injects a reminder of it once per session, on the first edit to the root file, rather than blocking the edit.

Source: byronbroughten/byro-repo#156, 67cdf77a
