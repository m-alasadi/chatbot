# PR1 Implementation Plan: Deterministic Grounded Mode + Retry Before Unavailable + Structured Traces

- PR: PR1
- Goal: Stabilize grounded answers and reduce false unavailable responses with minimal-risk changes
- Risk level: Low to medium

## 1) Exact Files to Edit

1. app/api/chat/site/route.ts
2. lib/server/function-calling-handler.ts
3. lib/server/site-api-service.ts
4. lib/server/evidence-extractor.ts
5. lib/server/system-prompts.ts
6. components/ChatWidget.tsx
7. tests/run-tests.js

New files:
1. lib/server/observability/chat-trace.ts
2. tests/pr1-grounded-stability.test.js
3. tests/pr1-retry-before-unavailable.test.js

## 2) Exact Functions/Modules to Add or Change

## app/api/chat/site/route.ts

Add:
- parseChatRequestCompat(json): normalizes request payload variants while preserving current behavior
- buildRequestTraceContext(request, sanitizedMessages): captures request-scoped trace context

Change:
- POST(request):
  - Use parseChatRequestCompat
  - Emit trace event for request_received and final_response_mode
  - Keep streaming behavior unchanged
  - Keep directAnswer bypass path unchanged from API contract perspective

## lib/server/function-calling-handler.ts

Add:
- evaluateNoDataRetryPlan(args, toolName): returns retry candidates before empty_results response
- runRetryBeforeUnavailable(toolName, args): executes bounded retry attempts

Change:
- processToolCall(toolCall):
  - Before generating empty_results suggestions, call runRetryBeforeUnavailable
  - Include structured retry metadata in tool response payload

- resolveToolCalls(...):
  - Emit trace events at forced intent selection, tool attempt, retry attempt, and final answer mode
  - Log result counts and top score from retrieved evidence when available

No signature changes to exported functions.

## lib/server/site-api-service.ts

Add:
- getTopScoreFromResults(data): utility for trace logging
- tryAlternativeSources(query, initialSource, limit, params): bounded fallback helper for PR1 only

Change:
- siteSearchContent(...):
  - Return deterministic metadata fields for trace:
    - result_count
    - top_score
    - source_attempts
  - No public response schema break: append optional fields only

## lib/server/evidence-extractor.ts

Change:
- generateDirectAnswer(query, evidenceList):
  - Ensure deterministic ordering and formatting of evidence list
  - Ensure stable tie-breaking (confidence, then source_title)

- formatGroundedAnswer(query, evidenceList):
  - Keep output template stable and deterministic

## lib/server/system-prompts.ts

Change:
- SITE_BOT_SYSTEM_PROMPT:
  - Remove routing ownership language that conflicts with runtime retry/orchestration
  - Keep grounding and style instructions

## lib/server/observability/chat-trace.ts (new)

Add:
- type ChatTraceEvent
- logChatTrace(event): structured JSON logging wrapper
- buildTraceId(): request trace id helper

Required event fields for PR1:
- normalized_query
- routed_source
- retry_attempts
- result_counts
- top_score
- answer_mode
- unavailable_reason (when present)

## components/ChatWidget.tsx

Change:
- Remove compile-breaking stray token at current line around renderMarkdown
- Keep request payload format unchanged

## tests/run-tests.js

Change:
- Stop assuming JSON-only chat response from /api/chat/site
- Add assertions for stream handling and compatibility behavior

## tests/pr1-grounded-stability.test.js (new)

Add:
- Repeat same grounded query N times and assert:
  - same answer_mode
  - same routed source family
  - same top result identity

## tests/pr1-retry-before-unavailable.test.js (new)

Add:
- Simulate empty first source and assert:
  - retry_attempts > 0
  - unavailable not returned before retries exhausted

## 3) Compatibility Notes

1. Keep POST /api/chat/site endpoint and stream behavior unchanged.
2. Keep use_tools behavior unchanged.
3. Keep all tool names unchanged in lib/server/site-tools-definitions.ts.
4. Keep executeToolByName export unchanged.
5. Keep widget payload compatibility for:
- components/ChatWidget.tsx
- public/widget.js
- public/widget-loader.js

## 4) Acceptance Criteria

1. Deterministic grounded mode:
- For high-confidence evidence path, repeated identical query returns same answer mode and stable grounded formatting.

2. Retry before unavailable:
- Empty first retrieval no longer immediately produces unavailable path.
- At least one bounded retry strategy is executed first.

3. Structured traces:
- Every grounded request logs normalized query, routed source, retry attempts, result count, and top score.

4. Production safety:
- No breaking API contract changes for /api/chat/site.
- Existing widget integrations continue to work.

5. Build safety:
- components/ChatWidget.tsx compiles without errors.

## 5) Tests for PR1

Automated:
1. tests/pr1-grounded-stability.test.js
2. tests/pr1-retry-before-unavailable.test.js
3. Updated tests/run-tests.js compatibility checks

Manual smoke scenarios:
1. Same Arabic question repeated 10 times -> same answer mode and same primary source family
2. Video-intent query where first source is empty -> retries before unavailable
3. Known grounded Abbas query -> deterministic grounded formatting
4. Widget send message through /api/chat/site -> successful streamed response

## 6) Rollout and Verification

1. Deploy with trace logs enabled in non-prod.
2. Run 24h shadow verification on repeated-query set.
3. Compare pre/post metrics:
- repeatability rate
- false unavailable count
- source precision on constrained content-type prompts
4. Promote to production after acceptance criteria pass.
