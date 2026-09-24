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
┌───────────────────────────────────────────────────────────────────────┐
│ Security onboarding   Ready   Preview · History · Export · Share · …  │
│ DESCRIPTION                   ┌ ☑ Allow player feedback  ★ 4.2 ───┐   │
│ Onboarding quiz for new…      │ ▸ Sound       −16 LUFS · … · 3 s  │   │
│                               └───────────────────────────────────┘   │
│ ┌ Ready to present.  ☐ Full capture   Back to draft  [ ▶ Present ] ┐  │
│ └ (while a session runs: its PIN, its players, its console)        ┘  │
├──────────────┬────────────────────────────────────────────────────────┤
│ QUESTIONS    │  Edit question                  Cancel  [ Save ]       │
│ 1 ▣ Choice   │  Type: [ Single choice           ▾]                    │
│ ▤ Slide      │  Prompt: [___________________________________]         │
│ 2 ▣ T/F ◀    │  ▸ Question media                       Image · Sound  │
│ ...          │  TIMING   Time [ 20 ]   Reveal delay [ auto ]          │
│ [ + Add ]    │  OPTIONS                                               │
│ [ + Slide ]  │   ▲ [ Answer A__________ ] ( ) right                   │
│              │   ◆ [ Answer B__________ ] (•) right   [+ option]      │
│ (drag to     │  ▸ Points                          Standard · …        │
│  reorder)    │  ▸ Answer explanation                                  │
│              │  ▸ Background                              None        │
└──────────────┴────────────────────────────────────────────────────────┘
```
- The **type** shapes the answers area (true/false = 2 options; text = a list of accepted answers; numeric = a value plus a tolerance; ordering = a sequence; poll = no "right" answer).
- **What is always in view** is what gets edited for every question: type, prompt, timing, answers. **The rest folds** (`▸`): every fold starts closed and its line says what it is set to, so a setting that differs from the norm never hides.
- **Question media** folds as one: the *visual* (image or video, with its alternative text) and the *sound* read as two groups; the sound's group ends with *listen first* and a folded *playback* (who hears it, waveform size).
- The quiz's own settings sit beside its description: player feedback in view, the **sound** (pause after a media, levelling, who hears it) folded on the row below. The status bar, full width, carries the one action that follows the quiz's state.
- Inline validation: a prompt is required, ≥ 1 right answer (RG-03), the time bounds. A field that refuses the save opens its fold, so the reason shows.

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
│  Who hears the sound in this session  (quiz with sound)   │
│  [ Projection and remote participants            ▾]       │
│  ☐ Record all answers                                     │
│     ⓘ The participants are told when the session starts.  │
│  ☑ Personalised tracking                                  │
│     ⓘ Off: the group's results only, nothing individual.  │
│  ☐ Let participants pick their display name   (OIDC only) │
│  ⓘ The next question's media reach the devices ahead.     │
│                                                           │
│  [ Start the session ]                       [ Cancel ]   │
└───────────────────────────────────────────────────────────┘
```
> The sound comes first: who hears it replaces the quiz's setting for this session (a
> question with its own setting keeps it). The "Record all answers" checkbox turns on
> **full-capture mode** (RG-13); the other two are personalised tracking (RG-16) and the
> chosen display name (RG-15). These three lock once the session has started. With media
> in the quiz, the host is told that the devices fetch them ahead (media brief §5.3).
> When the server allows open access (RG-15), the launch first asks how participants get
> in — accounts required or open access — unless the host ticked *Remember my choice* before
> (then kept with the account, changed back in *My account → Preferences*); the
> lobby then states it, and in open access personalised tracking is greyed out with the
> reason and the display-name switch is gone. A last switch closes the session to new
> participants; the in-game control bar carries the same toggle, since late joins stay
> open during play.

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

### 5.2 bis The notice — what the session records
Shown on joining, **before** anything is collected, in the wording the two switches call for:

| Personalised tracking | Full capture | The notice says |
|---|---|---|
| on | no | Your taking part and your score are recorded under your account. |
| on | yes | …and every one of your answers is kept. |
| off | — | Your individual results are not recorded — only the group's overall results are. |

```
┌───────────────────────────────┐
│  ⓘ Your taking part and your  │
│  score are recorded under     │
│  your account.                │
└───────────────────────────────┘
```
> It matches the `notice { fullCapture, personalTracking, pickOwnName }` event (séquences §2 /
> technique §9). Informational (transparency, RG-13 and RG-16). Picking a display name is
> never anonymity: the notice must not let anyone believe otherwise.

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
| What the session records | The notice, in one of its three wordings (RG-13, RG-16) |
| The end of the session | The podium → a thank-you screen |

---

## 9. Ergonomic principles (v1)

- **Mobile first** on the participant side: large touch targets, one action per screen.
- **Legible when projected**: the prompt on the big screen, the bare minimum on the phone (which may show only the colours and shapes).
- **Immediate feedback** every time (right or wrong + points + rank).
- **Accessibility**: colour **and** shape, AA contrast, keyboard navigation (the host console), touch targets ≥ 44 px.
- **i18n** FR/EN; the labels externalised.
- **The least possible cognitive load** for the participant while the chrono runs.
