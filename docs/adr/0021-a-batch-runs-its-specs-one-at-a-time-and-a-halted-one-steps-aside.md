# A Batch runs its specs one at a time, and a Halted one steps aside

A Batch runs one member's ticket at a time in one process; a member held by a Halt steps aside for the next runnable one, and the Batch goes Idle only when every unfinished member is held by a Halt or a lease. Launching each member as its own run, side by side, would need almost no runner code, but those runs would share one Active account's 5-hour window, land against each other when they touch the same files, and need a concurrency cap before a Batch could hold every ready standalone ticket; running them in turn with a Halt holding the whole Batch would let one question stall tickets that have nothing to do with it.

Source: the grilling behind the Batch glossary entry, c4acb760
