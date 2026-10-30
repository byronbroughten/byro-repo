# A code edit is denied until the style doc is read in full

The most common miss was editing code without ever opening the style doc. So an agent's first code edit in a session is denied until it has read the style doc, and the refusal names that one read and says to retry. The gate denies rather than injecting the doc: an injection would pay the whole file on every first edit, even when it is already in context, whereas a deny leaves the agent to take the read once. Only a read covering the whole file counts, since a gate a five-line read unlocks is no gate. Since #393 this is a row of `readFirstGate`, which gates prose and tier-code edits the same way.

Source: byronbroughten/byro-repo#108, byronbroughten/byro-repo#110, byronbroughten/byro-repo#393
