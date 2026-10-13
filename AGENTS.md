# AI Learning Companion

## Architecture
- `electron/main.cts` owns native windows and explicit IPC handlers. `electron/preload.cts` exposes a small typed bridge. `src/` is the React renderer and must never import Electron or Node modules.
- Keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. Do not expose arbitrary IPC, filesystem, shell, or network access through the bridge.
- Vite builds the renderer into `dist/`; TypeScript builds Electron CommonJS entry points into `dist-electron/`.
- Shared Zod contracts are in `shared/contracts.cts`. Main and renderer validate domain data; `electron/ipc/validation.cts` additionally checks sender window, main frame, origin, exact payload fields, and size limits.
- SQLite is owned by `electron/persistence/`. Use parameter binding, transaction boundaries, repository abstractions, and append-only numbered migrations. Never send SQL, filesystem paths, or database handles through IPC.
- OpenAI SDK clients and decrypted saved credentials exist only in `electron/ai/`. Settings accepts a transient password through validated one-way save IPC; never return the saved key. Use Electron safeStorage encryption without plaintext fallback, storing ciphertext separately from SQLite. Block credential changes during AI work and reset cached clients after changes. Environment configuration supplies model/request overrides only; never load API keys from it. Never log provider objects, key-bearing objects, or raw exceptions. SDK logging stays off.
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

## AI interviews
- AI interviews use `InterviewService`, `InterviewRepository`, and migration 4, separate from legacy offline practice snapshots. Persist candidate answers before any follow-up request.
- Keep role/level/type/duration/job context/language/mode in validated contracts. All AI requests and Realtime sockets remain in main; narrowly scoped IPC owns each active interview.
- Rubric version 1 is defined in shared interview contracts. Scores require exact finalized candidate-answer evidence; insufficient evidence uses null. Never predict hiring probability or infer vocal/personal traits from transcripts.
- Voice uses consented mono PCM24k input, ephemeral bounded output playback, explicit turn taking, and durable duplicate-safe transcripts. Stop devices/playback on pause, navigation, interruption, duration expiry, or exit. Resume restores finalized text only, never raw audio.
- Compare only matching role, experience, type, language, and rubric versions; disclose question/duration/mode differences. Test lifecycle, schema/evidence rejection, concurrency, restart recovery, and mocked native voice paths without real API calls.

## Resource discovery and planning
- `LearningService`, `LearningRepository`, shared learning contracts, and migration 5 own discovery and personalized plans separately from legacy workspace snapshots.
- Use real hosted web search. Accept URLs only from completed search citation annotations; never from generated prose or model-created course lists. Normalize/deduplicate without losing approval. Preserve source domains, gap provenance, and exact inferred-gap excerpts.
- Verification uses bounded HTTPS HEAD requests, validated public IPv4 DNS addresses pinned to the request, and redirect validation at each hop. No arbitrary URL IPC, private-network requests, credentials, page downloads, or raw HTML rendering. Renderer source clicks pass resource IDs only.
- Reachability is not proof of resource content, cost, certificate, access, or text-only suitability. Label AI difficulty/time/relevance estimates and unverified metadata explicitly. Prefer official documentation, educational institutions, and established free educators.
- Plans and tasks start proposed; only explicit approval activates work. Validate unique stable task keys, acyclic prerequisites, approved source IDs, durations, and deadlines. Enforce task lifecycle and completion dependencies. Never generate URLs inside activities.
- Preserve practice attempts when editing, including question/criteria/revision snapshots. Exact submitted-answer excerpts support scores; compare only matching revisions and avoid mastery claims. Detect concurrent task edits before attaching AI assessments.
- Persist approvals, review decisions, and completion before reporting success. Saved text activities and metadata remain available offline. Search/AI are explicit online actions; no calendar/email execution.

## MCP action execution
- Use the official MCP SDK stdio server in `electron/mcp/` and the direct launcher in `scripts/`. Keep stdout protocol-only. The Node launcher bridges a private authenticated IPC stream to headless Electron for Windows compatibility; no HTTP transport/backend is exposed. Headless `--mcp` uses the chosen initialized profile, OS-encrypted credentials, and no renderer or HTTP backend. Never instantiate recording/interview recovery services in concurrent MCP mode.
- `ActionEngine` owns proposals, exact payload digests/revisions, desktop-only approval, provider-grant binding, and execution claims. Expose no MCP approval/OAuth/credential/arbitrary network/SQL tools. Treat MCP input as untrusted validated domain data.
- User reviews exact recipients/body or calendar dates/time zone/reminder before approval. IPC approval must include the reviewed digest/revision and nonsecret connection grant ID; edits invalidate approval. Provider account changes must not silently redirect approved work.
- `electron/integrations/` owns Google adapters and encrypted OAuth vaults. Use system-browser Desktop OAuth, loopback-only callback, PKCE S256, state verification, timeout/cancel, minimal scopes, and verified Gmail sender identity. Never expose refresh/access tokens or client secrets to renderer/MCP/logs/SQLite/bundles.
- Calendar restricts to owned primary events, no invitees, deterministic IDs/digest markers, and idempotent reconciliation. Gmail drafts are local; send uses gmail.send plus OpenID/email identity, with no inbox reads, remote drafts, contacts, or attachments.
- Never automatically retry Gmail sends. Ambiguous failures or interrupted claims stay uncertain and block resend. Atomic SQLite claims prevent concurrent execution; successful retries return the previous outcome. Record safe failures/outcomes with revision/digest in migration 6.
- Approved opportunity watches are checked only by explicit CLI worker/scheduler invocations; never imply background polling when no worker runs. Real source search remains explicit and demo opportunities labelled. No unrelated provider or microservice work.
- Use mocked Google/OAuth transports and isolated profiles for integration tests; verify official SDK discovery/invocation and real stdio client operation. Never send actual emails or mutate real calendars in tests.

## MVP Skills and monitoring
- Version reusable Skills in `skills/<name>/SKILL.md`; use discovered narrow MCP tools, preserve transcript-sharing consent and desktop-only approvals. Model-driven validation is distinct from mocked MCP contract tests.
- Headless `--monitor` uses the same local initialized profile and encrypted credential stores, never recording/interview recovery services. One-shot worker checks approved enabled watches with leases/due times in migration 7; no automatic scheduler installation.
- Retrieve bounded public HTTPS text with validated DNS pinning on every redirect. Structured opportunity facts need exact retrieved quotes; absent facts remain unknown. Excerpts prove provenance, not semantic correctness.
- Generated alert emails are proposals requiring exact review. The worker can send only approved current revisions/grants and cannot retry failed/uncertain delivery automatically. Watch disable stops future checks/sends. Persist stable alert identities and safe outcomes across restart.
- Deterministic demo uses synthetic provider/AI/search responses, isolated local data and simulated review/clock ticks. Never present it as live provider or background monitoring verification.
