# Split a large spec into Phases at learning points, and ticket one Phase at a time

#213 wrote 21 tickets up front, many for layers whose value couldn't be known until earlier ones were used. A large spec is now split into Phases where real use could change or cancel what follows, and only the next Phase is ticketed. Each Phase but the last ends at a `ready-for-human` Phase gate, closed only by `/code-tickets`, so the runner stays unaware of Phases. Larger tickets with more handoffs were rejected: each handoff pays the fixed reads again, a large ticket runs every piece at its hardest piece's pair, and handoffs are written under context pressure.

Source: byronbroughten/byro-repo#251
