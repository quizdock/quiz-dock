# QuizDock — Mockups & screens (wireframes)

> The **UI / screen journey** view, low fidelity (ASCII). It complements `SPECIFICATIONS-METIER.md`.
> v1 scope: a company session, individual mode, private quizzes.
> Version 1.0 — 2026-06-09. The wireframes fix the **content and the hierarchy**, not the visual style.

---

## 0. Conventions

- 3 surfaces: the **host console** (desktop), the **projected game screen** (big screen / projector), the **participant client** (mobile).
- `[ Button ]` an action · `( ) / (•)` a choice · `▣` a media area · `▮▮▮` a bar or gauge · `⏱` the chrono.
- Kahoot-like answer colours, **each answer being a colour and a shape** (▲ ◆ ● ■) for accessibility.

---

## 1. Authentication / home

### 1.1 Home (signed out)
```
┌──────────────────────────────────────────────┐
│                 QUIZDOCK                     │
│              Interactive quizzes             │
│                                              │
│   ┌──────────────────────────────────────┐   │
│   │  Join a session                      │   │
│   │   PIN: [ _ _ _ _ _ _ ]     [ Join ]  │   │
│   └──────────────────────────────────────┘   │
│                                              │
│   A host?        [ Sign in ]                 │
│                  (OIDC / SSO or local mode)  │
└──────────────────────────────────────────────┘
```
> Under `AUTH_MODE=none`, "Sign in" opens a plain local-name field.

---

## 2. Host console (desktop)

### 2.1 Dashboard — my quiz bank
```
┌───────────────────────────────────────────────────────────┐
│ QUIZDOCK   My quizzes │ History              Claire ▾     │
├───────────────────────────────────────────────────────────┤
│ [ + New quiz ]            Search [____________]  🔍       │
│                                                           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│  │ ▣ Onboarding│ │ ▣ Security  │ │ ▣ Product   │          │
│  │ 12 questions│ │ 8 questions │ │ 5 questions │          │
│  │ READY       │ │ DRAFT       │ │ READY       │          │
│  │ [Start ][⋯] │ │ [Edit  ][⋯] │ │ [Start ][⋯] │          │
│  └─────────────┘ └─────────────┘ └─────────────┘          │
│                                                           │
│  Filters: ( ) All (•) Ready ( ) Drafts ( ) Archived       │
└───────────────────────────────────────────────────────────┘
```
The `⋯` menu: Edit · Duplicate · Archive · Delete · See past sessions.
> "Start" is disabled on a DRAFT (RG-02).

### 2.2 Quiz editor (the builder)
```
┌───────────────────────────────────────────────────────────┐
│ ◀ Back   Quiz: [ Security onboarding      ]      [ Save ] │
├──────────────┬────────────────────────────────────────────┤
│ QUESTIONS    │  Question 3 / 12                           │
│ 1 ▣ Choice   │  Type: [ Single choice           ▾]        │
│ 2 ▣ T/F      │  Prompt: [_______________________________] │
│ 3 ▣ Choice ◀ │  Media : [ ▣ Add an image or sound ]       │
│ 4 ▣ Text     │  ⏱ Time: [ 20 s ▾]   Points: [1000 ▾]      │
│ ...          │                                            │
│ [ + Add ]    │  Answers:                                  │
│              │   ▲ [ Answer A__________ ] ( ) right       │
│ (drag to     │   ◆ [ Answer B__________ ] (•) right       │
│  reorder)    │   ● [ Answer C__________ ] ( ) right       │
│              │   ■ [ Answer D__________ ] ( ) right       │
│              │                        [+ option] (max 6)  │
│              │  [ Preview ]                    [ Delete ] │
└──────────────┴────────────────────────────────────────────┘
```
- The **type** shapes the answers area (true/false = 2 options; text = a list of accepted answers; numeric = a value plus a tolerance; ordering = a sequence; poll = no "right" answer).
- Inline validation: a prompt is required, ≥ 1 right answer (RG-03), the time bounds.

### 2.3 Previewing a question
```
┌───────────────────────────────────────────────────────────┐
│  Preview (what a participant sees)              [ Close ] │
│  ▣ media                                                  │
│  "Which sign gives away a phishing email?"                │
│  ⏱ 20 s                                                   │
│  ▲ Red              ◆ Blue                                │
│  ● Yellow           ■ Green                               │
└───────────────────────────────────────────────────────────┘
```

---

## 3. Running a session — the host console

### 3.1 The lobby (host side)
```
┌───────────────────────────────────────────────────────────┐
│  Session: Security onboarding                             │
│  PIN: 4 8 2 9 1 7          [ Show it large ]              │
│  Participants connected: 23                               │
│                                                           │
│  marc · sophie · leo · nadia · ...  (click a name to      │
│                                      throw them out)      │
│                                                           │
│  ☐ Record every answer (audit / certification)            │
│     ⓘ The participants are told when the session starts.  │
│                                                           │
│  [ Start the session ]                       [ Cancel ]   │
└───────────────────────────────────────────────────────────┘
```
> The "Record every answer" checkbox turns on **full-capture mode** (RG-13). It locks once the session has started.

### 3.2 During a question (host side)
```
┌───────────────────────────────────────────────────────────┐
│  Question 3 / 12                                ⏱ 12 s    │
│  "Which sign gives away a phishing email?"                │
│                                                           │
│  Answers received: 18 / 23   ▮▮▮▮▮▮▮▮░░                   │
│                                                           │
│  [ Reveal now ]      [ Pause ]      [ End the session ]   │
└───────────────────────────────────────────────────────────┘
```

### 3.3 Reveal + leaderboard (host side)
```
┌───────────────────────────────────────────────────────────┐
│  Right answer: ◆ "An unknown sender plus an urgent link"  │
│  Distribution:  ▲ 4   ◆ 15 ✓   ● 2   ■ 2                  │
│                                                           │
│  Leaderboard                                              │
│   1. sophie    8 450                                      │
│   2. marc      8 120                                      │
│   3. nadia     7 900                                      │
│   ...                                                     │
│                                  [ Next question ▶ ]      │
└───────────────────────────────────────────────────────────┘
```

---

## 4. The projected game screen (big screen)

### 4.1 The projected lobby
```
┌───────────────────────────────────────────────────────────┐
│          Join at  quiz-dock.app    —    PIN: 482917       │
│                                                           │
│      marc   sophie   leo   nadia   karim   inès   ...     │
│                        23 players                         │
└───────────────────────────────────────────────────────────┘
```

### 4.2 A projected question
```
┌───────────────────────────────────────────────────────────┐
│  "Which sign gives away a phishing email?"            ⏱14 │
│  ▣ media                                                  │
│  ┌───────────────┐ ┌───────────────┐                      │
│  │ ▲  Answer A   │ │ ◆  Answer B   │                      │
│  └───────────────┘ └───────────────┘                      │
│  ┌───────────────┐ ┌───────────────┐                      │
│  │ ●  Answer C   │ │ ■  Answer D   │                      │
│  └───────────────┘ └───────────────┘                      │
│             Answers received: 18 / 23                     │
└───────────────────────────────────────────────────────────┘
```
> The projection **never shows** the right answer before the reveal (anti-cheat, technique §7).

---

## 5. Participant client (mobile)

### 5.1 Joining
```
┌───────────────────┐   ┌───────────────────┐
│   PIN             │   │  Your nickname    │
│  [ 4 8 2 9 1 7 ]  │ → │  [ marc________ ] │
│   [ Join ]        │   │  [ Let's go! ]    │
└───────────────────┘   └───────────────────┘
```

### 5.2 The waiting room
```
┌───────────────────┐
│   You are in the  │
│      game!        │
│      "marc"       │
│  Waiting for the  │
│  host…            │
└───────────────────┘
```

### 5.2 bis The full-capture notice (when it is on)
Shown on joining, **before** anything is collected, once the host has turned full recording on:
```
┌───────────────────────────────┐
│  ⓘ This session is recorded   │
│  Your individual answers      │
│  will be kept as part of the  │
│  session follow-up.           │
│              [ Understood ]   │
└───────────────────────────────┘
```
> It matches the `notice { fullCapture:true }` event (séquences §2 / technique §9). Informational (transparency, RG-13).

### 5.3 Answering (the heart of the app)
```
┌───────────────────┐
│       ⏱ 14        │
│ (the prompt is on │
│  the big screen)  │
│ ┌──────┐ ┌──────┐ │
│ │  ▲   │ │  ◆   │ │
│ └──────┘ └──────┘ │
│ ┌──────┐ ┌──────┐ │
│ │  ●   │ │  ■   │ │
│ └──────┘ └──────┘ │
└───────────────────┘
```
- Text input → a text field; numeric → a slider or the keypad; ordering → a list to drag.
- Once answered: "Answer recorded ✓" plus a lock (one answer, RG-06).

### 5.4 Immediate feedback
```
┌───────────────────┐    ┌───────────────────┐
│     ✓ Right!      │ or │     ✗ Missed      │
│    +850 points    │    │     +0 points     │
│   Streak: 🔥 x3   │    │   Rank: 7th       │
│   Rank: 3rd       │    │                   │
└───────────────────┘    └───────────────────┘
```

### 5.5 The final podium (participant + projection)
```
┌───────────────────────────────┐
│            🏆 Podium          │
│           ┌────┐              │
│      ┌────┤ 1  ├────┐         │
│  ┌───┤ 2  │sophie│ 3 ├───┐    │
│  │marc│   │ 8450 │   │nadia│  │
│                               │
│   Your place: 2nd — 8 120     │
│   [ See my answers ]          │
└───────────────────────────────┘
```

---

## 6. The session report (host)

### 6.1 Summary
```
┌───────────────────────────────────────────────────────────┐
│  Report — Security onboarding — 2026-06-09                │
│  Participants: 23     Mean success rate: 72 %             │
│  [ Export CSV ]                                           │
│                                                           │
│  Final leaderboard                                        │
│   Rank  Nickname  Score   Right    Mean time              │
│    1    sophie    8 450    11/12     6.2 s                │
│    2    marc      8 120    10/12     7.1 s                │
│   ...                                                     │
└───────────────────────────────────────────────────────────┘
```

### 6.2 Per-question analysis (what needs revisiting)
```
┌───────────────────────────────────────────────────────────┐
│  Question                          Success   Mean time    │
│  Q1  What phishing is               91 %        5.0 s  ✅ │
│  Q2  A strong password              48 %        9.8 s  ⚠️ │  ← needs revisiting
│  Q3  Signs of a suspicious email    65 %        7.3 s     │
│  ...                                                      │
│  (click a row → the detailed answer distribution)         │
└───────────────────────────────────────────────────────────┘
```

---

## 7. Participant history (signed in)
```
┌───────────────────────────────────────────────────────────┐
│  My sessions                                              │
│  Date        Quiz                   Score    Rank         │
│  2026-06-09  Security onboarding    8 120    2nd / 23     │
│  2026-06-02  Product v2             5 600    5th / 18     │
│  (progress over time ▮▮▮▮▮▮▯▯)                            │
└───────────────────────────────────────────────────────────┘
```
> Available only under `AUTH_MODE=oidc` (an identified participant).

---

## 8. Cross-cutting states & messages

| Situation | Message / screen |
|-----------|-----------------|
| An invalid PIN / a closed session | "No session for that PIN." |
| The nickname is taken | "That nickname is taken, pick another one." |
| A participant disconnects | A "Reconnecting…" banner → it resumes by itself (technique §11) |
| The host disconnects | "The host disconnected, the game is paused." |
| A participant is thrown out | "The host removed you from the session." |
| A late answer | "Time is up — your answer was not counted." |
| The session is recorded (full capture) | The notice "Your answers will be kept" → [ Understood ] (RG-13) |
| The end of the session | The podium → a thank-you screen |

---

## 9. Ergonomic principles (v1)

- **Mobile first** on the participant side: large touch targets, one action per screen.
- **Legible when projected**: the prompt on the big screen, the bare minimum on the phone (which may show only the colours and shapes).
- **Immediate feedback** every time (right or wrong + points + rank).
- **Accessibility**: colour **and** shape, AA contrast, keyboard navigation (the host console), touch targets ≥ 44 px.
- **i18n** FR/EN; the labels externalised.
- **The least possible cognitive load** for the participant while the chrono runs.
