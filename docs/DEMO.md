# Guided MVP demonstration

## Reproducible offline proof

Run `npm install`, `npm run build`, then `npm run demo:scheduled`. This composes the real SQLite repositories, session/interview services, planning validation, ActionEngine, official SDK MCP client/server, discovery and monitoring worker. AI, retrieval, Google delivery and human review are **simulated**. It does not read your credentials, capture a microphone, make network calls, send email, or mutate a calendar. Ten numbered steps are printed and a new isolated temporary directory holds `companion.sqlite` and `report.json`. Open that profile with `npm start -- --user-data-dir="ABSOLUTE_DEMO_DIRECTORY"` to inspect its persisted artifacts. Demo terms are synthetic even though the React resource URL identifies a real source. No live price/deadline claim is made.

The scheduled tick uses an injected clock advanced six hours, followed by a duplicate check; it is not a real six-hour wait or an installed scheduler. Simulated review calls the same desktop-owned engine approval operation. Real MCP clients have no approval operation. `npm test` verifies the scenario, native UI, transports and recovery; `npm run test:skills` exercises each Skill's MCP workflow separately. These tests validate contracts and side-effect boundaries, not an independent Codex model's reasoning.

## Live guided scenario

Use an initialized desktop profile, your OpenAI key saved in Settings, a configuration supporting Responses/web search/Realtime, and the Google Desktop OAuth client described in [MCP.md](MCP.md). Connect your MCP client to **the same profile**. Live operations can incur API costs; synthetic demo commands do not. Participants must consent before audio capture. Text/notes are sufficient for the full demonstration.

| Step | Action | Evidence to inspect |
| --- | --- | --- |
| 1 | Learning Sessions → Record & reflect. Start “React state workshop” in notes mode; enter the text in `demo/sample-data.cjs`, or attend a consented voice session. Pause/resume, then end. | Durable final transcript; tracks stop on pause. |
| 2 | Generate summary and star the relevant excerpt. | Concepts, gaps and “Practice queued updates” assignment quote; explicit assignment versus AI suggestion. |
| 3 | Learning Resources: search “React queued state updates”, select the session gap, prefer text; save the official guide. Or invoke `$learning-session-followup` with transcript-sharing authorization. | Cited source URL, link status; time/difficulty are estimates. |
| 4 | Learning Planner → Personalized plans: 30 minutes/day, optional deadline. Generate, edit and approve tasks/plan. Complete a prerequisite and submit its assessment. | Plan state, dependencies, exact answer excerpts, persistence after restart. |
| 5 | Mock Interviews → AI interview: Frontend Developer, Entry-level, Technical, five minutes, English, text. Explain queued updates and answer the follow-up. | Adaptive question and answer saved before the next request. |
| 6 | End and request feedback. | Rubric scores with exact candidate-answer evidence and practice topics. |
| 7 | Invoke `$learning-opportunity-discovery`: “Find free React training relevant to my goal.” | `opportunities.search` real results, retrieved cost/eligibility/deadline quotes or explicit unverified fields; checkedAt. No seeded listing is a live offer. |
| 8 | Propose a future study event and follow-up email using MCP. Review precise dates/zone, recipient/body and connected sender in Action Center, then approve. | Exact digest/revision/grant-bound approvals. |
| 9 | Explicitly request `learning.actions.execute` for each approved ID. | Recorded provider outcomes; repeat invocation returns the original outcome without another mutation. |
| 10 | Propose a watch with a query, interval and your notification address; approve and execute registration. Run `npm run monitor:once -- --user-data-dir="ABSOLUTE_PROFILE"`. Review the new alert email in Action Center, approve, then run the worker again. | Monitoring panel shows actual check time, pending review, delivery outcome and no duplicate alert on a later identical check. |

If a search returns no matching sources, show the honest empty outcome. Do not alter provider facts to force an alert. `freeOnly` skips unknown/paid cost, so a broad free course query may be necessary. Do not claim hardware, account access, email delivery or live terms were verified by mock tests.

## Independent Codex Skill checks

Skills are versioned in `skills/<name>/SKILL.md`. To invoke without installing, provide the absolute SKILL.md path and ask Codex to use it. For automatic discovery, copy the desired folder to your user Skills directory or repository `.agents/skills` and start a fresh Codex chat, following [official Skill guidance](https://learn.chatgpt.com/docs/build-skills). This project does not change your global Codex configuration. Connect the Companion MCP server first ([MCP.md](MCP.md)).

Test each in a fresh chat against an isolated demo profile:

1. “Use learning-session-followup at `ABSOLUTE_REPO/skills/learning-session-followup/SKILL.md`. Follow up my completed React workshop. You may read its transcript; propose a text study plan, but do not execute external actions.” Expect actual session IDs/evidence, no invented gap/resource IDs, and an unapproved plan. Repeat with no completed sessions: expect a useful empty-state explanation.
2. “Use learning-opportunity-discovery at `ABSOLUTE_REPO/skills/learning-opportunity-discovery/SKILL.md`. Find free React training; my region is Nigeria. Do not register a watch yet.” Expect source links, timestamps, cited terms or unverified labels and transparent ranking. Repeat offline: expect stale saved results or a clear unavailable outcome, never fabricated offers.
3. “Use learning-progress-review at `ABSOLUTE_REPO/skills/learning-progress-review/SKILL.md`. Review unfinished commitments and recommend my next 30-minute activity; read-only.” Expect approved commitments separated from proposals, prerequisites respected, and no task/provider mutations. Test a profile with no history and an uncertain email: expect no fabricated progress or resend.

Model-driven checks require a real Codex session and may incur usage. Automated Skill contract checks use mocked data and no billed API calls.
