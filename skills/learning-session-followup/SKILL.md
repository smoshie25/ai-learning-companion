---
name: learning-session-followup
description: Turn a completed Companion learning session into evidence-based gaps, relevant resources, and a proposed study plan using its MCP tools.
---

Discover the connected AI Learning Companion MCP tools before invoking them; names may carry a client namespace. If disconnected, explain how to connect using the repository's docs/MCP.md and stop tool-dependent work.

Use `learning.sessions.list` and `learning.sessions.get` to select a completed session. Start with metadata and summary. Request `includeTranscript: true` only when the user authorizes sharing that session text with the client. An interrupted or partial session is not a completed assignment source: ask the user to finish it or offer a clearly provisional reflection.

Read `learning.context.get` for goals, existing inferred gap IDs, approved resources and commitments. Distinguish explicit assignments from suggested activities. Support claims with saved exact excerpts/IDs when present; never infer skill deficits merely from silence. Preserve unanswered questions as tentative gaps.

Use `learning.resources.discover` with a focused goal, existing gap IDs and `textOnly: true` unless the user requests otherwise. Cite only returned URLs. A reachable link does not establish price or eligibility. Resources require saving/approval in Learning Resources before attachment to a plan.

Use `learning.plans.propose` with the user's daily budget, optional deadline and existing gap IDs after resources are approved. If no gap ID exists, describe the tentative gap in the goal and leave gapIds empty; do not invent IDs. Check the returned durations, dependencies and assessment questions. Present the proposal for desktop Learning Planner review; do not claim it is approved or completed.

Return the session evidence, tentative gaps, source links, plan ID and next review step. If asked for a calendar/email action, use the corresponding proposal tools only. Approval occurs in Action Center; invoke `learning.actions.execute` only after explicit user authorization and verified approval. Never retry uncertain Gmail delivery.
