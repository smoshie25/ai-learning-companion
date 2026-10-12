# AI Learning Companion

## Architecture
- `electron/main.cts` owns native windows and explicit IPC handlers. `electron/preload.cts` exposes a small typed bridge. `src/` is the React renderer and must never import Electron or Node modules.
- Keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. Do not expose arbitrary IPC, filesystem, shell, or network access through the bridge.
- Vite builds the renderer into `dist/`; TypeScript builds Electron CommonJS entry points into `dist-electron/`.
- Shared Zod contracts are in `shared/contracts.cts`. Main and renderer validate domain data; `electron/ipc/validation.cts` additionally checks sender window, main frame, origin, exact payload fields, and size limits.
- SQLite is owned by `electron/persistence/`. Use parameter binding, transaction boundaries, repository abstractions, and append-only numbered migrations. Never send SQL, filesystem paths, or database handles through IPC.
- OpenAI SDK clients and credentials exist only in `electron/ai/`. Load `config/development.env` only in development; production uses the main-process environment. Never log provider objects, key-bearing objects, or raw exceptions. SDK logging stays off.
- All AI outputs are parsed and validated. Responses requests use `store: false`; retries and timeouts are centrally configured. Realtime sockets are owned by one window and closed on reload, exit, or idle timeout. Never replay a submitted Realtime turn automatically.
- Use React, strict TypeScript, Tailwind v4, shadcn-style Radix primitives in `src/components/ui`, and Lucide icons. Use `@/` aliases for renderer imports.

## UI conventions
- Colors, typography, spacing, radii, and theme values belong in `src/styles.css`. Light and dark modes share semantic tokens.
- Reuse Button, Dialog, page headers, cards, badges, and form controls. All controls need accessible names, visible focus, and keyboard support. Respect reduced motion.
- Keep seeded opportunities clearly illustrative. Offline practice remains available without credentials. Live AI learning and interview feedback must explain when data is sent to OpenAI.
- Persist learner data in SQLite through the workspace provider. Preserve legacy localStorage data during the one-time bootstrap migration. Browser-only preview uses localStorage and cannot call AI. Never store credentials in either data store.
- Use validated form drafts, explicit save confirmation, and visible persistence errors. Never report a save as complete until the IPC persistence queue has flushed.
- Keep navigation and state transitions predictable; provide explicit confirmation for destructive actions and helpful empty states.

## Validation
- Run `npm run build` after changes. `npm run dev` launches Vite and Electron; `npm run dev:web` runs only the renderer.
- Run `npm test` for unit tests and native Electron journeys, IPC validation, and persistence across process restart. `npm run test:unit` tests migrations/repositories, SDK retries/parsing/redaction, and Realtime ownership without network calls.
- Use isolated Electron user-data directories and mocked OpenAI transports in tests. Never use real API keys or make billed API calls in automated tests.
- Update README when commands or architecture change. Do not add real integrations without explicit scope.

## Session intelligence
- Recorded sessions have a separate main-owned lifecycle in `electron/ai/session-intelligence.cts`; do not write them through the renderer workspace snapshot. Use `IntelligenceRepository` and migration 3. Received transcript deltas are durable; raw audio is never persisted.
- Require participant consent and trusted-frame permission checks before microphone capture. Windows system audio needs explicit native confirmation. Pause/navigation/reload/exit must release tracks and sockets. Resume never replays old audio.
- Use bounded sequenced PCM16 mono 24 kHz IPC packets. Keep partial excerpts and interruption notices; exclude partial text from AI action evidence.
- Validate structured summaries and live highlights against finalized transcript IDs and exact quoted substrings. Keep explicit assignments and AI-suggested activities distinguishable; do not automatically create planner tasks.
- Test lifecycle, transcript recovery, audio format, consent/ownership, and evidence with mocked SDK sockets and isolated databases; never capture real microphones in automated tests.
