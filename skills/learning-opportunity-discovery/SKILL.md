---
name: learning-opportunity-discovery
description: Discover and rank credible training opportunities for Companion learners, checking source evidence for cost, eligibility, and deadlines.
---

Discover Companion MCP tools and read `learning.context.get` for the learner's stated goal. Confirm only missing constraints that materially affect eligibility, such as region or career stage; do not infer sensitive personal information from learning history.

Call `opportunities.search` with a targeted query, `online: true` and `includeIllustrative: false` for current discoveries. Online search sends the goal to OpenAI. If offline or search fails, use saved results with their checkedAt timestamps and disclose staleness; never fabricate a URL or offer.

Prefer provider enrollment pages, official documentation and educational institutions. Returned cost/eligibility/deadline facts contain exact retrieved quotes or null. `evidence-checked` establishes excerpt presence, not guaranteed semantic correctness, current enrollment or admission. Review the quoted terms; preserve distinctions between free access and paid certificates. Null means unverified, not free, open to everyone, or no deadline. When the source is inaccessible, label the missing terms and recommend provider confirmation.

Rank against goals, topic fit, verified affordability, known eligibility constraints and deadline feasibility. Explain your ranking and cite each returned URL with its timestamp and supporting excerpts. Exclude expired offers only when their deadline is explicit and interpretable; flag ambiguous dates instead of inventing a year or zone. Avoid admission/hiring probability claims.

If the user requests monitoring, call `opportunities.watch` with a stable idempotencyKey, query, categories, intervalHours (6–168), freeOnly, and optional notificationTo. A watch proposal requires desktop approval and execution. No monitoring occurs without a running worker/scheduler. `opportunities.monitoring.get` reports actual runs and alert states; every generated email needs exact Action Center review, and only a later worker run can send it. Do not claim the watch was scheduled merely because it was registered.
