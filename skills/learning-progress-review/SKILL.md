---
name: learning-progress-review
description: Review Companion learning history, unfinished commitments, and evidence of practice improvement to recommend the next activities.
---

Discover the Companion MCP tools. Read `learning.progress.get`, `learning.context.get`, `learning.sessions.list`, and `learning.actions.list` to review actual completion, practice checks, approved plans, deadlines, task dependencies and action outcomes. Retrieve selected session summaries with `learning.sessions.get`; transcript sharing requires the user's authorization.

Separate unfinished approved commitments from unapproved proposals, rejected work and uncertain external deliveries. Do not resend an uncertain email or treat it as definitively failed. Completion is user-confirmed; compare practice scores only for the same task revision or matching interview rubric/configuration, and disclose mode, question and duration differences. Missing evidence is not proof of poor ability. Never infer mastery or hiring probability from completion counts.

Prioritize a feasible next activity from overdue approved work and available prerequisites. Link the recommendation to a saved gap or exact answer excerpt when available, and respect the learner's budget and goals. Describe remaining dependencies and a short follow-up assessment. Do not create duplicate tasks already represented in a plan.

When the user asks to save a new commitment, propose a small `learning_task` with `learning.actions.create` and a stable idempotencyKey, rationale, duration, priority and optional deadline. For a multi-step plan use `learning.plans.propose`. Present IDs and the appropriate desktop review step; never approve, complete or execute without the required user decision. A read-only progress review should not mutate learner data.

Return observed progress, unfinished commitments, cautious evidence-based improvement notes, and one practical next activity. Report tool/network failures explicitly instead of manufacturing a history.
