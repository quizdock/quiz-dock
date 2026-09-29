# Bringing a quiz from another tool

## Kahoot spreadsheet

In the dashboard, choose **Import** and select an `.xlsx` file using the
[official Kahoot template](https://support.kahoot.com/hc/en-us/articles/115002812547-How-to-import-questions-from-a-spreadsheet-to-your-kahoot).
The template has one sheet, headers on row 8 and questions starting on row 9.
The file name becomes the draft title. Delete the template's example question
if you do not want to import it.

QuizDock keeps the wording, answer order, correct answers and time limits
(5–120 seconds). One correct answer becomes single choice; several become
multiple choice. At least two answers are required. Unsupported or invalid
rows are skipped and reported by spreadsheet row number and reason. If no
question can be converted, no draft is created. Formula cells are skipped;
links, pictures and sounds are not read or fetched. The draft inherits the
instance language and has no licence: check both before publishing it.

The API uses the existing `POST /quizzes/import` upload. Kahoot imports include
an `importReport` with `source`, `converted` and `skipped` (row/reason).
The operator command `qd quiz:import file.xlsx user@example.com` prints the
same report. An existing Kahoot quiz URL is not an import source; Kahoot's
spreadsheet template is an input format, not a quiz export.

## Other source formats

QuizDock also imports its own `quiz.json`, alone or zipped with media
([the bundle format](../quiz-bundle.md)). For PDFs, screenshots or other files,
a chatbot can do the
conversion: give it what you have, [the prompt](#the-prompt) and
[the format guide](#the-format-guide), and it writes a `quiz.json` that
QuizDock imports. It works from almost anything:

- **a PDF** — on Kahoot, print the kahoot's page from the browser and choose
  *Save as PDF*: questions, answers with the right one marked;
- **screenshots** — of each question with its answers, when nothing can be
  printed or exported; a phone photo of a quiz on paper works too. The chatbot
  has to read images: most current ones do;
- **a spreadsheet** — another sheet with one question per row;
- **text** — a Word document, notes, a list pasted as is.

> **What you send leaves your instance.** The chatbot's provider receives the
> content of the quiz. Use one you trust with it.

## Step by step

1. Open a chatbot and paste [the prompt](#the-prompt). Attach
   [the format guide](#the-format-guide) — or paste it below the prompt — and
   your quiz (several screenshots in one message is fine).
2. It answers with a JSON block and a short *To check* list. Save the block as
   a file ending in `.json` — copy it into a text editor, or download it when
   the chatbot offers a file.
3. In QuizDock: dashboard → *Import*, pick the file. The quiz opens as a new
   draft.
4. **Read the *To check* list, then go through the quiz** before playing it:
   - the correct answers — a chatbot can misread a mark, or guess one the source
     did not show;
   - the images — none are imported (see below); add your own from the media
     library;
   - the time limits — one over QuizDock's maximum is shortened.

If the import is refused, the message names the item and the field at fault:
paste it back to the chatbot and ask for a corrected file.

## What comes across

| From | Becomes |
|---|---|
| Quiz, one correct answer | single choice |
| Quiz, several correct answers | multiple choice |
| True or false | true / false |
| Type answer | text answer, with the accepted spellings |
| Slider | numeric answer, with its margin as the tolerance |
| Puzzle | ordering |
| Poll | poll (no points) |
| Slide | a slide with a heading and a text |
| Double points / no points | the same, per question |
| Time limit | the same, within QuizDock's limits |

Word clouds, open-ended and brainstorm questions have no equivalent: they are
left out and listed under *To check*.

**Images and sounds stay behind, on purpose.** A `quiz.json` without its zip
carries no media, and the pictures of a Kahoot quiz often come from licensed
image banks: they are not yours to copy. The chatbot notes which questions had
one, and you add your own — the media library links to free libraries
(Openverse, Wikimedia Commons…).

## The format guide

[`schema/quiz-format-guide.md`](../../schema/quiz-format-guide.md)
([download](https://raw.githubusercontent.com/quizdock/quiz-dock/main/schema/quiz-format-guide.md))
describes the file the importer accepts: its fields, the question types and
what each asks for, the limits, the answer colours, what to leave out, and a
complete example. It is generated from the importer itself, so it follows every
change of the format: take the latest one rather than a copy kept aside.

## The prompt

Copy it whole. It is written in English, the language chatbots follow best;
the quiz itself keeps its own language. The format is in the guide: the prompt
only says how to convert.

```text
Convert the quiz I give you (PDF, screenshots, spreadsheet or text) into a QuizDock quiz file, following the attached "QuizDock quiz file — format guide" exactly.

Answer with ONE JSON code block, then a short "To check" list. Nothing else.

Pick each question's type from what the source asks the players to do:
- one correct answer: single_choice; several: multiple_choice; true or false: true_false;
- a typed answer: text_input, with every spelling the source accepts;
- a number or a slider: numeric, with the source's margin as the tolerance;
- answers to put in order (a puzzle): ordering;
- a survey with no correct answer: poll;
- word clouds, open-ended or brainstorm questions have no equivalent: leave them out.
A page of information between questions becomes a slide.

Rules:
- Keep the source's wording, order and language. Do not translate, shorten or improve anything.
- Keep the source's time limits and double or no points.
- No images, sounds or videos. When a question needs its picture to make sense, keep the question.
- Never invent a correct answer. For each question, look at whether the source marks the right answer (a tick, a colour, bold, a key). When it does not, choose the one you are sure of, or make it a poll if you are not; either way, list the question under "To check", even when the answer seems obvious.
- Before answering, go through the guide's checklist and fix what fails. Every change made to fit a limit (a shorter time, a shortened text, answers dropped) goes under "To check".

"To check" lists, by question number in the source: questions left out and why, answers you chose yourself, pictures that were lost, limits you had to change (time, length, number of answers). Write "Nothing" when the list is empty.
```
