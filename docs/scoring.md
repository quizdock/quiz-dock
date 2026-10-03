# Scoring

How an answer earns points (`apps/backend/src/game/scoring.ts`, pure functions
covered by golden tests).

## Base

- **Base points** come from the question's points mode: `standard` 1000,
  `double` 2000, `none` 0, `fixed` 1000 without speed weighting.
- **Speed**: a right answer earns `base × (1 − t/T / 2)` — everything when
  instant, half at the time limit (`fixed` mode skips this).
- **Streak**: `+100` per consecutive right answer beyond the first, capped at
  `+500`. A wrong answer resets it; an unscored question (poll, `none`) leaves
  it untouched.
- A late answer (after the deadline + 300 ms grace) is refused before it is scored: it does
  not count, and the streak stays as it was — as with no answer at all.

## Scoring rules per type (`question.scoring`)

| Type | `standard` (default) | Variant |
| --- | --- | --- |
| single choice, true/false | right option = full credit | — |
| multiple choice | all or nothing: the ticked set must match exactly | `partial`: `(right ticks − wrong ticks) / right answers`, never below 0 |
| ordering | all or nothing: every element in place | `partial`: share of elements at the right position |
| text input | exact match after normalisation (case, accents, spaces) | `lenient`: Levenshtein distance ≤ 1 up to 5 letters, ≤ 2 beyond |
| numeric | within `numericTolerance` of the target | `closest`: see below |
| poll | never scored | — |

**Partial credit** gives `credit × timed points`; the streak neither grows nor
breaks. Full credit behaves like a right answer.

**Closest wins** (numeric) is settled at the reveal, once every answer is
known: answers are ranked by distance to the target (ties share a rank).
Exact (within the tolerance) = full base points; otherwise 100 / 75 / 50 /
30 % by rank, 10 % beyond the fourth. No speed bonus — precision is the
game. The reveal shows the ranking (nickname, value, distance, points) and
each participant sees their own rank and distance.
