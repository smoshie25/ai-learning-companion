# Opportunity worker

The desktop app installs **no background scheduler**. An enabled watch is only permission to check its topic when the worker runs; it is not proof monitoring is active. Action Center displays last recorded runs, states and a disable control. MCP `opportunities.monitoring.get` returns the same evidence.

## One local run

Build first. Approve and execute an `opportunity_watch` in Action Center (or execute its approved ID through MCP). Optional `notificationTo` is a reviewed destination for local alert proposals; it does not authorize sending arbitrary future emails. Then:

```powershell
npm run monitor:once -- --user-data-dir="C:\absolute\initialized\profile"
```

The Node launcher starts headless Electron to access OS-encrypted saved credentials and exits after one pass. No window or HTTP backend is created. Do not run a raw Node process against encrypted credentials. Default profile is Electron's usual application user-data directory. Explicit profiles must match the desktop/MCP profile, be local, and be initialized once in the app.

Each invocation checks at most 20 due approved watches, and considers pending notifications for all enabled watches; due checks respect the reviewed 6–168 hour interval. Search uses existing OpenAI web-search citations; only actual returned URLs enter discovery. Up to six source pages per watch are fetched as bounded text (256 kB download, 16,000 characters to structured extraction), with public IPv4 DNS pinning, HTTPS-only redirects and timeout limits. No scripts/images/media are executed or downloaded. Generated fact excerpts must appear exactly in retrieved text. Excerpt presence does not guarantee AI interpretation; confirm actual offer terms with the provider. Unknown facts stay null. `freeOnly` requires explicitly evidenced free access; paid certificates remain distinct.

Rank is a simple topic/title and known-provider heuristic, not an eligibility/admission predictor. Categories inform the search query, not a provider taxonomy guarantee. Dynamic/authenticated/oversized pages may remain unverified. Search absence is not interpreted as an offer being withdrawn. AI extraction can vary between checks and produce false-positive term changes; review source excerpts before approving an alert. Meaningful title/term/verification changes produce alerts; retrieval timestamps and rank changes alone do not. Each watch/source/version has a stable alert identity, including after restart or returning to a previously seen version.

New alerts with a destination create **exact email proposals** in Action Center. Review the source quotes, destination, subject and body, connect Gmail, and approve. On a subsequent invocation the worker sends approved emails through ActionEngine/GmailAdapter even if the watch's next search is not yet due. No MCP or worker code grants approval. Edits clear approval, reconnection invalidates a previous account grant, rejected alerts remain rejected, and failed/uncertain deliveries are not retried automatically. Manually re-review a definitive failure in Action Center; uncertain delivery requires checking Sent mail and remains blocked. Watches without recipients retain local matches only. Disable stops future checks/sends; already executing sends cannot be undone.

SQLite migration 7 owns results, snapshots, alerts, outcomes and per-watch leases. Leases renew during search and expire ten minutes after a stopped worker's last heartbeat. Atomic ActionEngine claims protect concurrent sends. Due times and successful delivery survive restart. Failures emit safe outcomes without raw provider exceptions/tokens. CLI emits JSON; exit 1 reports a failed check/send in the invocation. A successful run can still have `needs-review` proposals; success never implies delivery.

## Local scheduled demonstration

`npm run demo:scheduled` runs the ten-step isolated deterministic scenario with mocked search/AI/Google and an advanced scheduler clock; it saves its report and SQLite profile to a new temporary directory. It demonstrates pending review, approval, delivery, and duplicate suppression without accessing real credentials. See [DEMO.md](DEMO.md). For a real local schedule, configure Windows Task Scheduler to invoke `node.exe` with `scripts/monitor-launcher.cjs` and the explicit profile path every hour, **under the same signed-in OS user**. Due watches will run at their own intervals. Disable the task to stop checks; the app does not create it automatically.

## Hosted scheduler compatibility

A scheduler can trigger the same one-shot command on a persistent worker host. For this proof of concept, a hosted scheduler should dispatch to a self-hosted runner under the user's OS account, with the initialized local profile and working safeStorage backend. Use a concurrency limit of one and a timeout appropriate to up to 20 sequential watches; poll once hourly, collect JSON/exit code, and do not interpret an absent heartbeat as healthy monitoring. Locked/unavailable keychains fail closed. Headless Linux may need a display/keyring session for Electron; there is no plaintext fallback.

An ephemeral hosted container cannot decrypt a copied Windows/macOS vault, access the local learner profile, or obtain desktop approvals. Moving to such a host would require an explicitly designed credential/provisioning and approval channel; **it is not implemented**. No hosted job, credentials upload, cloud infrastructure or deployment is created here. Do not commit/upload profile databases or ciphertext as scheduler configuration. Keep the desktop available for alert review and trigger a later worker pass to send approved content.
