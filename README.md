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
- Configurable three-question practice interviews with stored answers, optional structured AI feedback, and reviewable history.
- Study plans, task creation, deadlines, completion filters, and computed progress.
- Filterable opportunities, details, bookmarks, search, and empty states.
- Locally saved preferences, collapsible navigation, light/dark themes, and Ctrl/Cmd+K workspace search.

Offline practice uses scripted responses. Live AI uses the official OpenAI JavaScript SDK in Electron main. Opportunities remain illustrative; enrollment and applications are not connected. Live AI uses your language and learning-level preferences; the interface remains English. Reminder scheduling and third-party integrations remain upcoming.

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

Search recorded sessions by title, topic, goals, transcript text, or summary; guided practice has a separate search field. Session history includes interrupted and completed sessions, highlights, evidence, and summaries. No resource discovery, calendar, or email integration is included.

Tests cover lifecycle transitions, consent and ownership, audio ordering, duplicate/out-of-order transcription events, partial transcript recovery, safe key redaction, restart persistence, literal search, strict summary extraction/evidence, and PCM encoding. Native Electron tests load the AudioWorklet under CSP, verify unauthorized microphone denial and consented synthetic PCM capture with a mocked transport, confirm pause stops audio packets, and exercise notes/pause/resume/search across restart. Tests do not record real devices or make billed API calls. Live microphone/system capture still needs verification on your hardware with your own key and consent.

Protocol references: [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription) and [Electron display capture](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts).
