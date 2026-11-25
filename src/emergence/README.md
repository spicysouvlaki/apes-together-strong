# Emergence engine

Workstream 2. Signals -> hidden affinity -> great-people points -> figure offers; deeds,
legends, culture hints, contested figures. Spec: docs/GDD.md section 4.

Called by the sim once per player at the start of each turn, after yields.
Never expose affinity numbers to the UI: only `cultureHint` events and offer reasons.
