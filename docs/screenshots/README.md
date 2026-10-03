# Screenshots

Every shot, in the order of a session: manage your bank and the shared templates, build
the quiz and its media, open the room, players join, questions, reveals, podium — then the
administration of the instance. After them, every question type and slide as the
big screen shows them. The README shows a selection.

They are the sample quizzes the application ships (France, Taiwan, Türkiye), whose pictures
and sounds come from Wikimedia Commons, credited in the app. `tools/screenshots/run.sh` takes
them all again, with the animated GIF, on a stack of their own (`tools/screenshots/`): see its header.

## A session

| | |
|---|---|
| ![My quizzes](my-quizzes.png)<br /><sub><b>My quizzes</b> — your bank: search, filter, import / export, one click to present</sub> | ![Templates](templates.png)<br /><sub><b>Templates</b> — quizzes shared on the instance, the samples among them; take an independent copy</sub> |
| ![Quiz builder](editor.png)<br /><sub><b>Quiz builder</b> — a question and its picture; 8 question types, video &amp; sound, slides</sub> | ![Image choice in the builder](editor-image-choice.png)<br /><sub><b>Image choice</b> — pictures as the answers, each with its alternative text</sub> |
| ![Slide in the builder](editor-slide.png)<br /><sub><b>Slides</b> — blocks, a background, a picture, previewed as they will show</sub> | ![My media](media-library.png)<br /><sub><b>My media</b> — reuse what you uploaded, with sizes and usages; links to free libraries</sub> |
| ![Global media](media-library-global.png)<br /><sub><b>Global media</b> — what the instance provides to every host, credited</sub> | ![Host console — lobby](console-lobby.png)<br /><sub><b>Host console</b> — the room's lobby: PIN, QR code, players in the room or remote and who is ready, who hears the sound</sub> |
| ![Host console — closed room](console-lobby-access.png)<br /><sub><b>Close the room</b> — once everyone is in, nobody else joins, even with the PIN</sub> | ![Projection — lobby](projection-lobby.png)<br /><sub><b>Projection</b> — the big screen while players join and get ready</sub> |
| ![Join](join.png)<br /><sub><b>Join</b> — nickname &amp; avatar, in the room or remote, then “I'm ready”</sub> | ![Content slide](projection-slide.png)<br /><sub><b>Content slide</b> — the quiz opens on its intro, a photo behind the title</sub> |
| ![Host console — slide](console-slide.png)<br /><sub><b>Host console</b> — a slide: the quiz outline, the transport</sub> | ![Projection — question with a picture](projection-media.png)<br /><sub><b>Projection</b> — a question with its picture on the big screen</sub> |
| ![Player — question and reveal](player-play.png)<br /><sub><b>Player in the room</b> — colour tiles to tap, then their own result</sub> | ![Projection — question](projection-question.png)<br /><sub><b>Projection</b> — live question, the answers in the grid every phone shares</sub> |
| ![Host console — question](console-question.png)<br /><sub><b>Host console</b> — timer and its adjustment, answers received, reveal now</sub> | ![Player — image choice](player-image-choice.png)<br /><sub><b>Image choice on a phone</b> — the pictures to tap, then the answer with its picture</sub> |
| ![Player — the big screen on a phone](player-big-screen.png)<br /><sub><b>Remote player</b> — the whole question on their phone</sub> | ![Projection — reveal](projection-reveal.png)<br /><sub><b>Reveal</b> — distribution, explanation, live leaderboard</sub> |
| ![Host console — reveal](console-reveal.png)<br /><sub><b>Host console</b> — the quiz outline to look back over, next question</sub> | ![Player — ordering and feedback](player-end.png)<br /><sub><b>Player</b> — ordering, then rate the quiz at the end</sub> |
| ![Podium](projection-podium.png)<br /><sub><b>Podium</b> — final results on the big screen</sub> | ![Preferences](preferences.png)<br /><sub><b>My account</b> — who you are, what you can do, the choices made once</sub> |
| ![Administration — statistics](admin-statistics.png)<br /><sub><b>Administration</b> — what is played right now, the instance at a glance, the last twelve months</sub> | ![Administration — settings](admin-settings.png)<br /><sub><b>Settings</b> — every variable with its value, where it comes from, its help, and its control</sub> |
| ![Administration — quizzes](admin-quizzes.png)<br /><sub><b>Every quiz of the instance</b> — whoever owns it: open, export, hand over, archive</sub> | ![Instance media](admin-media.png)<br /><sub><b>Instance media</b> — disk by kind and owner, clean-up, every file as a grid or a list</sub> |
| ![Media detail](admin-media-preview.png)<br /><sub><b>A media file</b> — beside the list: a sound on its waveform, its format, length, owners and usages</sub> | |

## Every question type and slide

As the big screen shows them, during the question and at the reveal.

| | |
|---|---|
| ![Single choice](types/single-choice.png)<br /><sub><b>Single choice</b> — with the question's picture</sub> | ![Multiple choice](types/multiple-choice.png)<br /><sub><b>Multiple choice</b> — tick them all, then submit</sub> |
| ![True or false](types/true-false.png)<br /><sub><b>True / false</b></sub> | ![Text input](types/text-input.png)<br /><sub><b>Text input</b> — typed on the phones; typos forgiven if the author wants</sub> |
| ![Numeric](types/numeric.png)<br /><sub><b>Numeric</b> — a number, within a tolerance or closest wins</sub> | ![Ordering](types/ordering.png)<br /><sub><b>Ordering</b> — put the answers in the right order</sub> |
| ![Poll](types/poll.png)<br /><sub><b>Poll</b> — no right answer, no points</sub> | ![Image choice](types/image-choice.png)<br /><sub><b>Image choice</b> — four pictures, one right</sub> |
| ![A question with a sound](types/single-choice-sound.png)<br /><sub><b>A sound</b> — the anthem to recognise, its waveform on the big screen</sub> | ![Image choice — reveal](types/reveal-image-choice.png)<br /><sub><b>Image choice — reveal</b> — the right picture, the others dimmed</sub> |
| ![Multiple choice — reveal](types/reveal-multiple-choice.png)<br /><sub><b>Multiple choice — reveal</b> — the distribution, every right answer ticked</sub> | ![Numeric — reveal](types/reveal-numeric.png)<br /><sub><b>Numeric — reveal</b> — the target and the closest answers</sub> |
| ![Ordering — reveal](types/reveal-ordering.png)<br /><sub><b>Ordering — reveal</b> — the right order</sub> | ![Intro slide](types/slide-intro.png)<br /><sub><b>Slide</b> — a title over a photo</sub> |
| ![Slide with a picture](types/slide-gradient.png)<br /><sub><b>Slide</b> — a picture and its text on a gradient</sub> |   |
