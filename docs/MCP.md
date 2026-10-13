# Local MCP action execution

AI Learning Companion exposes an official MCP SDK stdio server. It is a local Electron main-process mode, not an HTTP backend. It shares the app's SQLite profile and OS-encrypted provider vaults without opening a renderer window. Codex and other compatible local MCP clients can discover tools, read authorized learning data, propose actions, and execute actions that a human already approved in the desktop app.

## Build and profile

Run `npm install` and `npm run build`, then open `npm start` once to initialize your profile. The usual Windows profile is `%APPDATA%/ai-learning-companion`. If starting the desktop app with `--user-data-dir`, use the same absolute directory for MCP. Connecting a profile grants the MCP client access to its learning metadata, action proposals, summaries/evidence, and optionally full transcripts.

Use the launcher directly. Do not use `npm run mcp` as a client's stdio command: npm can write banners to stdout. The Node launcher forwards protocol traffic on stdout and diagnostics on stderr. It connects to Electron through a private one-use IPC stream with a random authentication nonce (a Windows named pipe, or a socket in an owner-only Unix temporary directory). This handles Windows GUI stdin limitations without an HTTP endpoint. It removes `ELECTRON_RUN_AS_NODE` for the headless Electron child.

Codex configuration example (adjust the executable and profile paths):

```toml
[mcp_servers.ai_learning_companion]
command = "C:/Program Files/nodejs/node.exe"
args = [
  "C:/Users/moshiem/Documents/ChatGPT/AI Learning Companion/scripts/mcp-launcher.cjs",
  "--user-data-dir=C:/Users/moshiem/AppData/Roaming/ai-learning-companion"
]
```

Other stdio clients can use equivalent JSON:

```json
{
  "mcpServers": {
    "ai-learning-companion": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "C:/Users/moshiem/Documents/ChatGPT/AI Learning Companion/scripts/mcp-launcher.cjs",
        "--user-data-dir=C:/Users/moshiem/AppData/Roaming/ai-learning-companion"
      ]
    }
  }
}
```

No MCP approval, credential-reading, OAuth authorization, shell, arbitrary URL, or SQL tool exists. Local MCP profile access is a same-OS-user trust boundary; do not connect clients you do not trust with that profile. There is no remote MCP endpoint or application login.

## Discovery and invocation

Use the official SDK client, or your host's normal MCP tool browser:

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const client = new Client({ name: 'learning-client', version: '1.0.0' })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    'C:/Users/moshiem/Documents/ChatGPT/AI Learning Companion/scripts/mcp-launcher.cjs',
    '--user-data-dir=C:/Users/moshiem/AppData/Roaming/ai-learning-companion'
  ]
})
await client.connect(transport)
const tools = await client.listTools()
console.log(tools.tools.map(t => ({ name: t.name, inputSchema: t.inputSchema })))
const sessions = await client.callTool({
  name: 'learning.sessions.list', arguments: { query: '', limit: 20 }
})
console.log(sessions.structuredContent)
// Close only after any required proposal/review/execute workflow.
await client.close()
```

Tool errors have `isError: true` and safe codes/messages. SDK schemas reject unexpected fields, oversized inputs, invalid emails, and malformed dates. Results include structured content as well as JSON text.

| Tool | Behavior |
| --- | --- |
| `learning.sessions.list` | Saved guided/recorded/interview metadata; no full transcript |
| `learning.sessions.get` | A `guided:<id>`, `recorded:<id>`, or `interview:<id>`; full text requires `includeTranscript: true` |
| `learning.actions.list` | Proposals, approval states, and latest outcomes; optional state/limit |
| `learning.actions.create` | Propose a validated domain action; never approves or executes |
| `learning.actions.execute` | Execute an unchanged desktop-approved action by ID |
| `learning.progress.get` | Separate legacy, personalized-plan, and MCP-task completion/practice data |
| `opportunities.search` | Saved real source links; `online: true` invokes existing configured OpenAI web search; demo catalog requires `includeIllustrative: true` |
| `opportunities.watch` | Propose monitoring preferences for review and local registration |
| `calendar.study.propose` | Propose a primary-calendar study event |
| `calendar.reminder.propose` | Propose a study event with a popup reminder |
| `gmail.followup.draft` | Save a local email draft for review; does not create a remote Gmail draft |

Online opportunity search returns sourced educational links, not verified enrollment/price offers. Watch registration stores query/categories/free preference and requested interval; background polling/notifications are not scheduled in this phase. No calendar invitation, inbox read, attachment, contact synchronization, or unrelated integration is implemented.

## Google authorization

1. Create your own Google OAuth client of type **Desktop app**, enable Calendar and Gmail APIs for that client project, and configure its consent screen/test users as Google requires.
2. Open **Settings → Google Calendar & Gmail**, enter the client ID and the desktop client secret if Google supplied one, then save. These values are encrypted locally; no shared client secret is bundled.
3. Connect Calendar or Gmail separately. The system browser displays account selection and consent. The callback listens only on IPv4 loopback, with a random path/state, PKCE S256, and a two-minute timeout. Embedded WebViews, out-of-band code copying, and passwords are not used.
4. Requested Calendar scope: `https://www.googleapis.com/auth/calendar.events.owned`. The adapter restricts execution further to the connected account's primary calendar, no attendee invitations.
5. Requested Gmail scope: `https://www.googleapis.com/auth/gmail.send`, plus `openid email` to verify the sender's email address. No inbox/compose/contacts scope is requested. Email drafts remain local.
6. Refresh/access tokens and the client configuration are stored in separate `google-*.enc` files using Electron safeStorage, with no plaintext fallback. Tokens never cross IPC or appear in MCP results, logs, SQLite, or renderer bundles. A nonsecret grant UUID binds approvals to a connection; refreshing a token retains that binding.
7. Disconnect removes local credentials immediately and requests Google revocation. If offline, revoke app access through Google account permissions. Google may invalidate other grants for the same client/account. Reconnecting or changing the OAuth client requires action review for the new connection.

Google may require consent-screen publishing/verification and can expire test-mode grants. Live account access still requires verification with your own registered OAuth client. No live OAuth, Google mutation, or billed OpenAI request is made by automated tests.

## Propose → review → execute

An AI host can propose an email:

```js
const draft = await client.callTool({
  name: 'gmail.followup.draft',
  arguments: {
    idempotencyKey: 'learning-followup-session-42',
    rationale: 'Ask my mentor to review the exercise we discussed.',
    email: {
      to: ['mentor@example.org'],
      subject: 'Please review my learning exercise',
      body: 'Could you review the attached-by-link exercise in our next session?'
    }
  }
})
const actionId = draft.structuredContent.id
```

This is a local proposal, with no provider call. The recipient above is a documentation example; replace it with the actual intended recipient and complete body before approval. No attachment is added.

Open **Action Center**. Review the sender, recipients, subject/body, or calendar start/end/time zone/reminder. Edit if necessary. **Review & approve → Confirm approval** persists the exact revision/digest and current provider grant. Edits clear approval. Account changes invalidate it. Approval is not execution.

After approval, the AI host can call:

```js
const outcome = await client.callTool({
  name: 'learning.actions.execute', arguments: { id: actionId }
})
```

Alternatively use the Action Center's separate execution confirmation. Unapproved execution returns `APPROVAL_REQUIRED`. The server has no way to grant approval or authorize Google.

Calendar example (choose future times):

```js
await client.callTool({
  name: 'calendar.study.propose',
  arguments: {
    idempotencyKey: 'study-session-42',
    rationale: 'Reserve thirty minutes for the approved study task.',
    event: {
      title: 'Focused study',
      description: 'Review the approved learning activity.',
      start: new Date(Date.now() + 24 * 3600000).toISOString(),
      end: new Date(Date.now() + 24 * 3600000 + 30 * 60000).toISOString(),
      timeZone: 'UTC',
      reminderMinutes: 10
    }
  }
})
```

Dates must include an explicit UTC offset that agrees with the IANA time zone at both instants. Invalid/nonexistent daylight-saving times, past events/reminders, invalid recipients, duplicate recipients, header injection, and unexpected fields are rejected. No recurrence or invitation fields are exposed.

Generic `learning.actions.create` supports `learning_task`, `calendar_event`, `calendar_reminder`, `email`, and `opportunity_watch`, each with an exact `{ kind, data }` schema. The discovery response contains these schemas. Local tasks and watch preferences also require review/approval before registration.

## Idempotency and outcomes

Migration 6 adds action records, attempt outcomes, provider grant bindings, MCP learning tasks, and monitoring preferences. Idempotency keys are unique; equivalent normalized payload digests are also deduplicated. Reusing a key for different content is an error. Atomic SQLite claims prevent two processes executing the same action. Successful re-invocation returns the prior result.

Calendar creation uses a deterministic provider event ID and private digest marker. An ambiguous creation can be reconciled through that ID without issuing another creation when the event exists. Changing calendar content after a definitive failure creates a new reviewed digest.

Gmail has no send idempotency key. Sending is never automatically retried. A lost connection, 5xx response, invalid success receipt, or stale executing claim becomes **uncertain**. Such an email cannot be resent through the same action. Check the connected account's Sent mail manually; do not create another equivalent send to work around uncertainty. A deterministic MIME Message-ID supports manual inspection without requesting inbox-read scopes.

Definitive provider rejections are recorded as failed and may be reviewed/retried. Unfinished executions become uncertain after two minutes rather than being blindly replayed. SQLite retains attempts/outcomes with timestamps and action revision/digest; it never stores provider tokens or raw provider errors. The Action Center displays the latest 100 actions and latest outcome; MCP supports state filtering.

## Tests

`npm run build` followed by `npm test` covers strict dates/zones/recipients, revision/grant approval, concurrent claims, idempotency, deterministic Calendar recovery, ambiguous Gmail failure, secure OAuth state/PKCE/token storage, real official-SDK tool discovery/calls, native desktop email review with a mocked adapter, and a real stdio client sharing a desktop profile without interrupting active learning.

References: [Official MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server), [Google desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Calendar event creation](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), and [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending).
