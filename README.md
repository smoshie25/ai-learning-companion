# AI Learning Companion

A desktop learning workspace built with Electron, React, TypeScript, Vite, Tailwind CSS v4, shadcn/ui-style Radix components, and Lucide icons.

## Run

Requires Node.js 24+ and npm (SQLite uses Node's built-in `node:sqlite`; Electron includes its own compatible runtime).

```sh
npm install
npm run dev
```

`npm run dev` runs the renderer, watches the Electron TypeScript files, and opens a native Electron window. Restart the Electron process after changing main or preload code. `npm run dev:web` runs the renderer alone at http://127.0.0.1:5173.

```sh
npm run build
npm start
npm test
```

The build creates `dist/` and `dist-electron/`. `npm start` opens the production build. `npm test` runs unit tests followed by real Electron journeys, security checks, and persistence checks across a process restart. Build before testing. `npm run test:unit` runs infrastructure tests alone. Screenshots are saved in `test-results/`. Tests use mock AI transports and isolated databases; they make no OpenAI network requests.

## Included

- Dashboard with recent sessions, actions, progress, and recommendations.
- Guided learning sessions with offline practice or live OpenAI responses, stored transcripts, structured summaries, highlights, and saved resource notes.
- Adaptive AI interviews with Realtime voice or text, role/language/job context, evidence-backed rubric scores, saved recovery, and performance comparisons; three-question offline practice remains available.
- Study plans, task creation, deadlines, completion filters, and computed progress.
- Filterable opportunities, details, bookmarks, search, and empty states.
- Locally saved preferences, collapsible navigation, light/dark themes, and Ctrl/Cmd+K workspace search.

Offline practice uses scripted responses. Live AI uses the official OpenAI JavaScript SDK in Electron main. Opportunities remain illustrative; enrollment and applications are not connected. Live AI uses your language and learning-level preferences; the interface remains English. Calendar study reminders and Gmail follow-ups are available through reviewed Action Center proposals; preference-only desktop reminders and Notion remain upcoming.

## Configure OpenAI locally

Open **Settings → OpenAI configuration**, enter your API key, and click **Save API key**. Select an application configuration and validate connectivity. Changes take effect immediately. Replace a key or remove it with confirmation; pause recording and disconnect Realtime before changing credentials.

Electron encrypts the key using operating system credential protection and saves ciphertext as `openai-key.enc` under the application user-data directory. The password field clears after submission. Saved keys are never returned to the renderer or stored in SQLite, localStorage, logs, or application bundles. Secure storage must be available; plaintext fallback is disabled. API keys in environment variables and development configuration are ignored.

Optional model IDs, request timeout, and maximum SDK retries can be configured in `config/development.env` for development (copy the example), or main-process environment variables. Restart Electron after changing these overrides. Model access depends on your API account.

In Settings, select **Offline practice**, **Everyday learning**, or **Focused reasoning**. Connectivity validation retrieves the configured model without generating a response; actual generation compatibility is verified on use. Realtime has a separate connect/send/disconnect text interface backed by a main-process WebSocket, with one socket per window and a one-minute idle timeout. This Settings tool is text-only. The Learning Sessions recording module captures microphone audio for transcription without playing generated audio.

Live learning sends the current conversation to OpenAI. Session summaries and interview feedback use strict JSON schemas and validate returned data. Refusals, incomplete responses, timeouts, quota failures, and authentication errors are projected to safe messages. Failed live requests preserve drafts instead of silently substituting mock responses. SDK retries are bounded (default 2), requests time out (default 20 seconds), and IPC allows one AI operation at a time with a 12-request/minute limit. Realtime turns are never automatically replayed.

Main-process AI usage metadata includes operation, configured model, token totals reported by the API, outcome, latency, and a safe error code. It does not contain prompts, transcripts, credentials, raw errors, or cost estimates. It counts logical application requests rather than SDK retry attempts.

Official references: [OpenAI JavaScript SDK](https://developers.openai.com/api/reference/typescript), [Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), and [Realtime WebSockets](https://developers.openai.com/api/docs/guides/realtime-websocket).

## Architecture

`electron/main.cts` creates a sandboxed window with context isolation enabled and Node integration disabled. `electron/preload.cts` exposes only typed workspace operations and task-specific AI operations. IPC validates the sender window, main-frame URL, payload shape and size, model-independent inputs, and connection ownership. There is no arbitrary IPC, SQL, file access, or renderer SDK client. Production CSP blocks renderer network access; development permits Vite HMR and its React preamble.

`electron/ai/` owns configuration, official SDK clients, errors, response parsing, and Realtime lifecycle. `electron/persistence/` owns repositories, transactions, and numbered schema migrations. `shared/contracts.cts` defines the domain schemas and bridge types. `src/lib/workspace.tsx` loads and saves domain data with an ordered persistence queue and visible failure/retry states. See `AGENTS.md` for architectural conventions.

## Local data

SQLite is stored as `companion.sqlite` under Electron's application user-data directory. It uses foreign keys, WAL journaling, prepared statements, transactional writes, and automatic numbered migrations. Domain tables cover learner profiles/preferences, sessions, ordered transcripts, interview results, resources, study plans, action items, opportunities/bookmarks, app preferences, and AI usage. Migration 3 adds intelligence sessions and transcript segments; it preserves all existing data. Legacy browser-saved learner data is imported once on the first SQLite bootstrap; original localStorage entries are retained as a backup and never overwrite an initialized database.

The browser-only preview still works with localStorage, and displays that storage mode explicitly; live AI requires Electron. The SQLite file contains learning content and is not encrypted at rest. If copying a running database for backup, include its WAL/SHM files or close the app first. The app needs no backend server, authentication, subscriptions, or cloud infrastructure.

The dashboard still uses a fixed October 12, 2026 demo day and illustrative time/streak metrics. Planner progress is computed from actual local tasks. Completed sessions, results, notes, preferences, active conversations, and interview drafts persist locally. An active draft resumes when you return to its screen after a restart; unsent learning-message text remains in the composer only until the window closes.

## Learning Session Intelligence

Open **Learning Sessions → Record & reflect**. Give the session a title, topic, and optional goals. Choose notes only, microphone, or microphone plus system audio. Notes sessions work offline. Audio transcription requires a configured API key and an OpenAI profile in Settings. `OPENAI_TRANSCRIPTION_MODEL` defaults to `gpt-live-transcribe`; model availability depends on your account. The transcription language follows your saved learning preference.

Recording starts only after participant consent and device authorization. Microphone permission is restricted to a trusted main-frame window with a consented active session. System loopback audio is supported on Windows only, with a separate native confirmation; it can include all audio playing on the computer. The requested screen stream is used only to acquire system audio: no screen pixels are recorded or sent. If the device or OS cannot supply system audio, recording stops visibly and you can choose microphone only.

Audio is mixed into mono PCM16 at 24 kHz using an AudioWorklet, then sent through bounded, sequenced IPC packets with main-process pacing and packet-rate limits to an official SDK WebSocket in main. A dedicated Realtime transcription session processes short audio turns. Received deltas and finalized text are saved immediately, using stable excerpt IDs; raw audio is neither persisted nor replayed. Important live concepts are extracted from finalized turns at most once every 30 seconds, and any excerpt can be starred manually. Automatic highlights are optional: their failure does not stop transcription.

Pause stops device tracks, drains the last received audio turn for up to five seconds, and closes the socket. Resume opens a new connection and reacquires devices; it does not replay old audio. Navigating away automatically pauses the session. Disconnects, backpressure, missing device tracks, and app restarts retain received text and mark interruptions. Unfinished text stays visibly partial and cannot be used as action evidence. Recording limits are 1,000 excerpts and 100,000 transcript characters per session; start another session if needed. Audio duration measures received frames; pause time and app downtime are excluded.

End saves metadata and transcript before attempting a summary, so a quota, network, parsing, or configuration failure cannot lose the session. Summaries can be generated or retried after ending. They include topics, concepts and explanations, conclusions, assignments/actions, knowledge gaps/questions, and recommended next steps. Strict JSON schemas validate all responses. Every action must quote an exact substring from a finalized excerpt, with its stable ID. Explicit assignments and AI-suggested activities have separate labels; review the evidence because classification is still an AI judgment. Actions are not automatically added to the planner.

Search recorded sessions by title, topic, goals, transcript text, or summary; guided practice has a separate search field. Session history includes interrupted and completed sessions, highlights, evidence, and summaries. Recorded sessions do not execute resource discovery, calendar, or email actions directly.

Tests cover lifecycle transitions, consent and ownership, audio ordering, duplicate/out-of-order transcription events, partial transcript recovery, safe key redaction, restart persistence, literal search, strict summary extraction/evidence, and PCM encoding. Native Electron tests load the AudioWorklet under CSP, verify unauthorized microphone denial and consented synthetic PCM capture with a mocked transport, confirm pause stops audio packets, and exercise notes/pause/resume/search across restart. Tests do not record real devices or make billed API calls. Live microphone/system capture still needs verification on your hardware with your own key and consent.

Protocol references: [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription) and [Electron display capture](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts).

## AI mock interviews

Open **Mock Interviews → AI interview** after saving an API key and choosing an OpenAI configuration in Settings. Configure any job role/career field, experience, technical/behavioral/general interview, 5–60 minute duration, optional job description, language, and text or voice mode. The Quick practice tab retains the three-question flow, with offline reflection in Offline practice configuration and optional AI feedback in an OpenAI configuration.

Text interviews use schema-validated Responses requests with the finalized saved conversation for adaptive questions and follow-ups. Answers are saved before requesting the next question, so failures cannot discard submitted content. Voice interviews use an official SDK Realtime WebSocket in Electron main, PCM16 mono 24 kHz microphone input, ephemeral PCM playback, and durable candidate/interviewer transcripts. The voice is AI-generated. Consent and trusted-frame microphone permission are required. Headphones are recommended. Turn taking mutes outgoing microphone audio while interviewer audio plays; listen to the full question before answering. Candidate answers use semantic VAD with low eagerness so thinking pauses and unfinished sentences are less likely to trigger a premature follow-up. Unlike a short fixed silence threshold, this uses sentence context and can wait up to eight seconds when completion is uncertain. A clearly completed thought can receive a faster reply. The interviewer prompt also discourages interjections. This is automatic detection, not a guarantee for arbitrarily long pauses; live timing still needs verification with your microphone and speaking style. Pause/resume or start a new voice connection after updating to apply the new policy.

Pause stops capture/playback, attempts to drain the final audio turn for up to 1.2 seconds, and closes the socket. Resume explicitly in voice (renewing consent) or text. Only finalized text restores context; raw audio is never stored or replayed. App reload/exit and connection failures retain received answers and mark the interview interrupted. Partial transcripts stay visible and are excluded from evaluation. Active elapsed time is checkpointed while the view is open; downtime is excluded, and reaching the selected duration ends the interview. Limits are 200 turns/100,000 transcript characters. The history lists the latest 100 interviews.

End an interview, then choose **Request interview feedback**. Rubric version 1 evaluates subject knowledge, communication clarity, reasoning/problem-solving, and answer completeness on a 0–5 scale, allowing unscored dimensions when evidence is insufficient. Every scored dimension and each strength/improvement must quote an exact substring of a finalized candidate answer. Invalid citations reject the assessment rather than displaying unsupported evidence. Recommendations describe practice topics; feedback must not predict hiring probability or infer personal/vocal traits.

History stores configuration, transcript, state, active duration, interruption notices, evaluation timestamp, and structured assessment in migration 4. Compare assessed interviews with the same role, level, type, language, and rubric version. Differences in questions, duration, and mode may affect scores; comparisons are practice signals, not standardized tests or hiring predictions.

Tests cover adaptive context, answer-before-request durability, lifecycle/concurrency, duration, strict SDK schemas, evidence, duplicate Realtime events, PCM bounds, encrypted key usage, restart recovery, native text/voice journeys, and comparisons. Automated voice tests use a synthetic device and mocked transport; live model access, voice quality, and physical hardware still need verification with your own key and consent. No automated test makes billed API calls.

Protocol reference: [OpenAI Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations).

## Resource discovery and personalized study planning

Open **Learning Resources** to search a goal with optional selected gaps. Summarized recorded sessions, assessed AI interviews, and legacy interview feedback supply tentative learning priorities with source labels. **Analyze saved learning** additionally analyzes finalized text from up to 12 completed recorded/interview/guided sessions. New inferred gaps require exact supporting excerpts and remain labelled AI-identified rather than confirmed ability measurements.

Discovery uses the official Responses API hosted `web_search` tool, required tool execution, and returned URL-citation annotations. URLs in generated prose are never accepted as sources. HTTPS URLs are normalized, tracking parameters removed, pages deduplicated, and known official documentation, educational domains, and established free educators prioritized. The selected model must support web search; unsupported access produces a visible error without substituting generated links. Goal and selected gap descriptions are sent to search, not full transcripts.

Each result shows citation title, source domain, URL, difficulty/time estimates, relevance, and verification status. Separate main-process HTTPS HEAD checks follow at most three redirects, pin a validated public IPv4 DNS address, and bound request/resolution times. Credentials, private/IP-literal URLs, nonstandard ports, and unsafe redirects are rejected. HEAD checks download no course body, images, video, or files. A reachable link confirms an HTTP response only; content, cost, enrollment, certificates, and estimates remain unverified. Some sites deny HEAD, so usable resources can remain unverified. Text preference excludes known video-only providers; detected HTML does not prove the page works entirely without video.

Save useful resources locally, then open **Learning Planner → Personalized plans**. Set a goal, selected gaps, daily study budget, optional deadline, and text preference. AI generates a proposed plan with short activities, suggested durations, priorities, task deadlines, an acyclic prerequisite graph, attached approved source IDs, follow-up questions, and criteria. Review/edit/approve/reject individual tasks, then approve the plan. Completion and practice checks require approved tasks and completed prerequisites. Rejected plans remain read-only in history; completion can be reopened subject to dependency rules. Existing planner tasks remain separate.

Saved text activities, criteria, plans, completion, source metadata, and practice history work offline; search, generation, link checks, external pages, and AI feedback need connectivity. Practice answers use schema-validated 0–5 feedback with exact answer excerpts. Editing retains prior attempts with question/criteria and revision snapshots; improvement comparisons use the same task revision and do not claim mastery. Learning pages are opened only by explicit source clicks through a narrow resource-ID IPC operation.

Migration 5 adds discovered resources, personalized plans, and gap analysis storage. Suggested results and proposals also persist so unfinished review survives restarts. Approved library items are deduplicated without losing approval on rediscovery. Resources referenced by non-rejected plans cannot be unsaved until their attachments are removed or the plan rejected. Resource discovery/planning do not execute external services directly; reviewed external actions use the MCP Action Execution layer below.

Tests use mocked search/verification/AI transports and isolated databases. They cover citation-only normalization, deduplication, private-network/redirect protection, strict planning schemas, task prerequisites and decisions, assessment evidence/concurrent edits, approval persistence, and a native discovery-to-plan-to-practice journey across restart. No test makes billed API calls or live third-party verification requests.

Official reference: [OpenAI web search and source citations](https://developers.openai.com/api/docs/guides/tools-web-search).

## MCP Action Execution

An official-SDK local stdio server exposes learning tools, proposals, approved action execution, evidence-checked opportunity search, and approved watch registration. Open **Action Center** to review exact proposals; configure Google Desktop OAuth in Settings for Calendar/Gmail. Tokens use OS encryption, approvals bind payload revisions and connections, and atomic idempotency records prevent duplicate execution. Email drafts are local; uncertain Gmail sends are never automatically retried.

See [MCP setup, tools, authorization, and execution examples](docs/MCP.md). No remote backend or unrelated microservice is added.

## MVP Skills, monitoring and demo

Three reusable Codex Skills live in `skills/`: learning-session-followup, learning-opportunity-discovery and learning-progress-review. They discover Companion MCP tools, preserve evidence and approval boundaries, and support independent invocation. See [guided demo and Skill test prompts](docs/DEMO.md).

Run `npm run demo:scheduled` for a reproducible ten-step proof with synthetic AI/search/Google responses, isolated SQLite data and scheduler ticks. No credentials, network or external changes are used. Run `npm run test:skills` for independent MCP contract checks; these do not assess Codex model reasoning.

`npm run monitor:once -- --user-data-dir="ABSOLUTE_PROFILE"` runs the live one-shot worker against enabled approved watches. It checks due queries, retrieves bounded source text, preserves exact term excerpts, detects changes, deduplicates alerts, creates notification email proposals and sends only reviewed approved emails through Gmail. Action Center shows actual outcomes and can disable watches. **Nothing monitors in the background unless this worker is running or your own scheduler launches it.** See [monitoring operations and hosted-scheduler limits](docs/MONITORING.md).

Migration 7 persists evidence-checked opportunity results, watch leases/due times, alerts and safe run outcomes. Unknown cost/eligibility/deadlines stay unverified; exact quotes validate provenance, not guaranteed AI interpretation. Live provider access, hardware and actual offer terms still need user verification. Every email requires individual review; the MVP has no blanket recurring-send approval. Hosted execution requires the same-user persistent runner and secure storage, not an ephemeral container.

## Document Intelligence & Study Assistant

Open **Study Documents** to import PDF, DOCX, TXT or Markdown locally. Consent gates all document AI operations. Source-grounded section/chapter/executive summaries, concepts, definitions, priorities, practice questions and flashcards persist in SQLite, with exact page/section excerpts available for inspection. Q&A retrieves relevant local chunks and returns an explicit unsupported outcome when evidence is absent. Selected sections/topics create reviewable Learning Planner proposals and document-based mock interviews.

See [document workflow, representative four-chapter guide, architecture and limits](docs/DOCUMENTS.md). Analysis supports progress, pause/recovery and failed-section retry. Limits are 20 MB, 1.5 million extracted characters, 400 chunks and 500 PDF pages. Scanned PDFs need an OCR/text export; DOCX pagination is not reconstructed. Quote validation establishes provenance, not guaranteed semantic correctness. No backend, cloud file store or embedding service is added.
