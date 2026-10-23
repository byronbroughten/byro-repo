# Runner steps get refusals, not prompts

A runner step has nobody to answer a prompt, so a call the gate would ask about would stall the run. The runner marks every step it launches, and in that mode each ask becomes a deny whose reason keeps the ask's message and tells the step to record a `denied-tool` blocker for the developer; the hook never raises a Halt. A session without the mark is Interactive, and its asks still go to the developer.

Source: byronbroughten/byro-repo#277
