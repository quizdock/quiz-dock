# Glossary

The vocabulary of QuizDock's interface, in the five shipped locales, and the
choices behind it. It extends the canonical glossary ratified in
[ADR 0001](../../../../docs/adr/0001-i18n-et-glossaire.md) (quiz / session /
participant / animateur / PIN) to every term the interface has grown since. Keep it in step with the `locales/*.json` files: when a term
changes, change it here and everywhere it appears (the parity test only checks
keys, not wording). Values below are copied from the dictionaries — `en` is the
reference, the others follow its sense, not its words.

## Roles and places

| Term        | en              | fr                   | es                   | zh            | zh-TW         | Where                                   |
| ----------- | --------------- | -------------------- | -------------------- | ------------- | ------------- | --------------------------------------- |
| quiz        | quiz            | quiz                 | quiz                 | 测验          | 測驗          | everywhere                              |
| my quizzes  | My quizzes      | Mes quiz             | Mis quizzes          | 我的测验      | 我的測驗      | topbar, `/quizzes`                      |
| editor      | Editor          | Éditeur              | Editor               | 编辑器        | 編輯器        | `/quizzes/:id`                          |
| host        | Host            | Animateur            | Anfitrión            | 主持人        | 主持人        | live                                    |
| host seat   | Host seat       | Siège hôte           | Asiento de anfitrión | 主持席位      | 主持席位      | local auth mode                         |
| participant | Participant     | Participant          | Participante         | 参与者        | 參與者        | live, console tab                       |
| nickname    | Nickname        | Pseudo               | Apodo                | 昵称          | 匿稱          | join                                    |
| session     | Session         | Session              | Sesión               | 会话          | 會話          | a quiz being played                     |
| room        | Room            | Salon                | Sala                 | 房间          | 房間          | one PIN, several quizzes in a row (#89) |
| console     | Console         | Console              | Consola              | 控制台        | 控制台        | `/session/:pin/console`                 |
| projection  | Projection      | Projection           | Proyección           | 投影          | 投影          | `/session/:pin/projection`              |
| join / PIN  | Join · PIN code | Rejoindre · Code PIN | Unirse · Código PIN  | 加入 · PIN 码 | 加入 · PIN 碼 | `/join`                                 |
| reviews     | Reviews         | Avis                 | Opiniones            | 评价          | 回饋          | `/quizzes/:id/reviews`                  |
| history     | History         | Historique           | Historial            | 历史          | 歷史          | `/quizzes/:id/history`                  |

## Content

| Term                     | en                             | fr                                    | es                               | zh                   | zh-TW                |
| ------------------------ | ------------------------------ | ------------------------------------- | -------------------------------- | -------------------- | -------------------- |
| question                 | Question                       | Question                              | Pregunta                         | 题目                 | 題目                 |
| slide                    | Slide                          | Slide                                 | Diapositiva                      | 幻灯片               | 簡報                 |
| option (answer choice)   | Option                         | Option                                | Opción                           | 选项                 | 選項                 |
| explanation              | Explanation                    | Explication                           | Explicación                      | 解析                 | 解析                 |
| background               | Background                     | Fond                                  | Fondo                            | 背景                 | 背景                 |
| outline (text halo)      | Outline (halo, like subtitles) | Contour (halo, comme des sous-titres) | Contorno (halo, como subtítulos) | 描边（光晕，如字幕） | 描邊（光暈，如字幕） |
| draft / ready / archived | Draft / Ready / Archived       | Brouillon / Prêt / Archivé            | Borrador / Listo / Archivado     | 草稿 / 就绪 / 已归档 | 草稿 / 就緒 / 已歸檔 |
| publish                  | Publish (ready)                | Publier (prêt)                        | Publicar (listo)                 | 发布（就绪）         | 發布（就緒）         |
| present                  | Present                        | Présenter                             | Presentar                        | 演示                 | 示範                 |
| import / export          | Import / Export                | Importer / Exporter                   | Importar / Exportar              | 导入 / 导出          | 匯入 / 匯出          |

## Play

| Term                | en                  | fr                             | es                             | zh           | zh-TW        |
| ------------------- | ------------------- | ------------------------------ | ------------------------------ | ------------ | ------------ |
| reveal              | Reveal              | Révéler                        | Revelar                        | 揭晓         | 揭曉         |
| leaderboard         | Leaderboard         | Classement                     | Clasificación                  | 排行榜       | 排行榜       |
| podium              | Podium              | Podium                         | Podio                          | 领奖台       | 領獎台       |
| leave               | Leave               | Quitter                        | Salir                          | 退出         | 離開         |
| looking back        | Looking back        | Retour en arrière              | Mirando atrás                  | 回顾         | 回顧         |
| back to live        | Back to live        | Revenir au direct              | Volver al directo              | 回到当前     | 回到目前     |
| full answer capture | Full answer capture | Capture intégrale des réponses | Captura completa de respuestas | 完整记录回答 | 完整記錄回答 |

## Scoring

| Term           | en                     | fr                        | es                            | zh                 | zh-TW              |
| -------------- | ---------------------- | ------------------------- | ----------------------------- | ------------------ | ------------------ |
| scoring (rule) | Scoring                | Barème                    | Puntuación                    | 计分规则           | 計分規則           |
| closest wins   | Closest answer wins    | Le plus proche gagne      | Gana la más cercana           | 最接近者胜         | 最接近者勝         |
| partial credit | Partial credit         | Crédit partiel            | Crédito parcial               | 部分得分           | 部分得分           |
| tolerate typos | Tolerate typos         | Tolérant aux fautes       | Tolerar erratas               | 容忍拼写错误       | 容忍拼字錯誤       |
| double points  | Double                 | Double                    | Doble                         | 双倍               | 雙倍               |
| fixed points   | Fixed (no speed bonus) | Fixe (sans bonus vitesse) | Fijo (sin bonus de velocidad) | 固定（无速度加分） | 固定（無速度加分） |

## Decisions

- **quiz, not questionnaire.** Product name and common usage; "questionnaire"
  reads like a survey. Kept as `quiz` in every locale (it is a loanword in
  fr/es); Chinese uses 测验/測驗 (a test one plays), not 问卷 (a survey).
- **session** (a quiz being played) rather than _game_ or _party_: neutral
  enough for classrooms and teams. fr _session_, not _partie_.
- **room** (one PIN, the participants joining once, several quizzes played in
  a row) vs **session** (one quiz played): fr _salon_, not _partie_ nor _soirée_.
- **host / animateur**: the person presenting. fr uses _animateur_
  (presenter/facilitator) — _hôte_ is kept only in _siège hôte_, where the
  seat is a technical lock, not a person.
- **participant, not player**: the people answering may be students or
  colleagues; _player_ only survives in code identifiers and route ids.
- **slide**: kept in French (common in presentation software); es
  _diapositiva_; zh-TW _簡報_ (noeFly's choice, #16), zh _幻灯片_.
- **console / projection**: the two host screens. _Console_ is the control
  surface (never _dashboard_, which is _My quizzes_); _projection_ is the big
  screen (never _display_ or _screen_, too generic).
- **reveal**: the moment answers are shown; a verb in the console (_Reveal
  now_) and a state everywhere else. fr _révéler / révélation_, never
  _correction_.
- **explanation**: the note shown at the reveal; not _solution_ (there may be
  none, e.g. a poll) nor _feedback_ (reserved for reviews).
- **reviews** (participants rating a quiz) vs **feedback** (the API/DB word):
  the interface says _reviews / avis_; `feedback` stays in identifiers only.
- **history** for archived sessions of a quiz (not _sessions_, which is the
  live word).
- **looking back / back to live**: the host showing a played step again;
  nothing is replayed, so no _replay_ / _rejouer_ wording anywhere.
- **scoring / barème**: the per-question rule. _Points_ (standard / double /
  fixed) is the amount; _scoring_ is how the answer earns it.
- **closest wins**: ranks numeric answers by distance; say _closest_, never
  _nearest guess_ (there is a right value).
- **partial credit** (multiple choice, ordering) vs **all or nothing**: the
  default is all or nothing, and its wording stays explicit in the rules line.
- **tolerate typos / lenient**: _lenient_ is the code value; the interface
  always explains it (_tolerate typos_), never says _fuzzy_.
- **host seat**: the single-host lock of local mode; _claim_, _extend_,
  _release_ are its verbs (never _login_ for the seat itself).
- **Taiwan usage in zh-TW**: 資料 (data), 檔案 (file), 清單 (list), 拖曳
  (drag), 送出 (submit), 儲存 (save), 自訂 (custom), 置中 (centre), 連線
  (connect — 連接 only in 連接埠, port), 簡報 (slide), 匿稱 (nickname), 回饋
  (feedback), 登出 (log out), 是非題 / 單選題 / 多選題 / 排序題 / 投票題
  (question types), 畫面 for an app screen vs 螢幕 for the physical one,
  「」 quotes, 破折號 ——. zh-TW is resolved straight to `en`, never through
  `zh`. The locale was contributed and reviewed by [@noeFly](https://github.com/noeFly) (#1, #16); later keys
  are machine-assisted and follow their choices — native review welcome.
- **No jargon leaks**: tokenised error codes (`quiz.not_found`…) are
  translated in `errors.json`; the interface never shows a code.
