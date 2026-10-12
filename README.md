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

Copy `config/development.env.example` to `config/development.env`, set `OPENAI_API_KEY`, and run `npm run dev`. This ignored file is read only by the main process in development mode; Vite does not load it. Environment variables take precedence over file values. Restart Electron after changing configuration. Production `npm start` reads the same variables from the process environment and does not read development files.

The model IDs for everyday learning, focused reasoning, and Realtime are configurable, as are request timeout and maximum SDK retries. Model access depends on your API account. No key is accepted through the UI, IPC, preload, or SQLite. Do not put credentials in `VITE_` variables, source code, logs, or a distributed application package.

In Settings, select **Offline practice**, **Everyday learning**, or **Focused reasoning**. Connectivity validation retrieves the configured model without generating a response; actual generation compatibility is verified on use. Realtime has a separate connect/send/disconnect text interface backed by a main-process WebSocket, with one socket per window and a one-minute idle timeout. This infrastructure does not yet capture or play microphone audio.

Live learning sends the current conversation to OpenAI. Session summaries and interview feedback use strict JSON schemas and validate returned data. Refusals, incomplete responses, timeouts, quota failures, and authentication errors are projected to safe messages. Failed live requests preserve drafts instead of silently substituting mock responses. SDK retries are bounded (default 2), requests time out (default 20 seconds), and IPC allows one AI operation at a time with a 12-request/minute limit. Realtime turns are never automatically replayed.

Main-process AI usage metadata includes operation, configured model, token totals reported by the API, outcome, latency, and a safe error code. It does not contain prompts, transcripts, credentials, raw errors, or cost estimates. It counts logical application requests rather than SDK retry attempts.

Official references: [OpenAI JavaScript SDK](https://developers.openai.com/api/reference/typescript), [Responses structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses), and [Realtime WebSockets](https://developers.openai.com/api/docs/guides/realtime-websocket).

## Architecture

`electron/main.cts` creates a sandboxed window with context isolation enabled and Node integration disabled. `electron/preload.cts` exposes only typed workspace operations and task-specific AI operations. IPC validates the sender window, main-frame URL, payload shape and size, model-independent inputs, and connection ownership. There is no arbitrary IPC, SQL, file access, or renderer SDK client. Production CSP blocks renderer network access; development permits Vite HMR and its React preamble.

`electron/ai/` owns configuration, official SDK clients, errors, response parsing, and Realtime lifecycle. `electron/persistence/` owns repositories, transactions, and numbered schema migrations. `shared/contracts.cts` defines the domain schemas and bridge types. `src/lib/workspace.tsx` loads and saves domain data with an ordered persistence queue and visible failure/retry states. See `AGENTS.md` for architectural conventions.

## Local data

SQLite is stored as `companion.sqlite` under Electron's application user-data directory. It uses foreign keys, WAL journaling, prepared statements, transactional writes, and automatic numbered migrations. Domain tables cover learner profiles/preferences, sessions, ordered transcripts, interview results, resources, study plans, action items, opportunities/bookmarks, app preferences, and AI usage. Legacy browser-saved learner data is imported once on the first SQLite bootstrap; original localStorage entries are retained as a backup and never overwrite an initialized database.

The browser-only preview still works with localStorage, and displays that storage mode explicitly; live AI requires Electron. The SQLite file contains learning content and is not encrypted at rest. If copying a running database for backup, include its WAL/SHM files or close the app first. The app needs no backend server, authentication, subscriptions, or cloud infrastructure.

The dashboard still uses a fixed October 12, 2026 demo day and illustrative time/streak metrics. Planner progress is computed from actual local tasks. Completed sessions, results, notes, preferences, active conversations, and interview drafts persist locally. An active draft resumes when you return to its screen after a restart; unsent learning-message text remains in the composer only until the window closes.
