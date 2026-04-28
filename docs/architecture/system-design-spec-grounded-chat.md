# System Design Spec: Grounded Arabic Chat Orchestration

- Version: 1.0
- Date: 2026-04-14
- Status: Approved for implementation

## 1) Scope and Goals

This spec defines the target server-side architecture for grounded Arabic answers in this repository while preserving current external integration behavior.

In scope:
- app/api/chat/site/route.ts execution path
- lib/server/function-calling-handler.ts orchestration logic
- lib/server/site-api-service.ts retrieval and tool execution facade
- lib/server/knowledge/* retrieval/indexing
- lib/server/evidence-extractor.ts answer composition

Out of scope:
- UI redesign
- API path changes
- tool name deprecations before compatibility window ends

## 2) Current Integration Contracts to Preserve

1. Endpoint contract:
- POST /api/chat/site must keep working for existing web/widget clients

2. Tool contract:
- Existing tool names in lib/server/site-tools-definitions.ts remain valid during migration

3. Embed contract:
- public/widget.js and public/widget-loader.js continue to function without required client-side migration in PR1-PR3

## 3) Target Layered Architecture

## A. Query Understanding Layer

Responsibility:
- Convert raw Arabic user query into structured intent and confidence.

Primary module:
- New: lib/server/query-understanding.ts

Input:
- Raw user text
- Optional conversation context (latest prior turn)

Output type:
- QueryIntent (see Types section)

Notes:
- Use existing normalization patterns from lib/server/function-calling-handler.ts and lib/server/knowledge/knowledge-index.ts, but unify via shared helper.
- Keyword lists become weak feature signals, not direct router branches.

## B. Retrieval Orchestration Layer

Responsibility:
- Build and execute bounded retrieval plan from QueryIntent.
- Enforce source constraints, retries, fallback broadening, and unavailable policy.

Primary module:
- New: lib/server/retrieval-orchestrator.ts

Compatibility integration:
- Called from lib/server/function-calling-handler.ts
- Uses executeToolByName facade in lib/server/site-api-service.ts during PR2-PR3

## C. Source Adapter Layer

Responsibility:
- Encapsulate source-specific fetch/normalize/score behavior.

Primary modules:
- New: lib/server/source-adapters/news-adapter.ts
- New: lib/server/source-adapters/video-adapter.ts
- New: lib/server/source-adapters/history-adapter.ts
- New: lib/server/source-adapters/abbas-adapter.ts
- New: lib/server/source-adapters/sermon-adapter.ts
- New: lib/server/source-adapters/language-adapter.ts

Compatibility integration:
- lib/server/site-api-service.ts remains facade and delegates internally.

## D. Ranking and Confidence Layer

Responsibility:
- Rank merged candidates with source-aware scoring and contamination penalties.
- Emit confidence and rejection reasons.

Primary modules:
- New: lib/server/ranking/ranker-v2.ts
- Existing integration point to evolve: lib/server/site-api-service.ts (scoreUnifiedItem, rankCandidateSources)
- Existing knowledge ranker to align: lib/server/knowledge/knowledge-search.ts

## E. Answer Composition Layer

Responsibility:
- Produce grounded answer from evidence deterministically when confidence is strong.
- Use constrained synthesis only when deterministic composition is insufficient.

Primary modules:
- Existing: lib/server/evidence-extractor.ts
- Existing integration point: lib/server/function-calling-handler.ts (tryGenerateDirectAnswer, injectKnowledgeAndGuard)
- Existing route mode switch: app/api/chat/site/route.ts

## F. Observability and Evaluation Layer

Responsibility:
- Emit structured trace logs and support repeatable evaluations.

Primary modules:
- New: lib/server/observability/chat-trace.ts
- Existing integration points: app/api/chat/site/route.ts, lib/server/function-calling-handler.ts, lib/server/site-api-service.ts
- Existing tests to modernize: tests/run-tests.js

## 4) Canonical Runtime Flow

1. Route receives request in app/api/chat/site/route.ts
2. Inputs are sanitized (existing data-sanitizer)
3. QueryUnderstanding returns QueryIntent
4. RetrievalOrchestrator executes RetrievalPlan
5. Ranker returns RankedRetrievalResult with confidence and retryNeeded
6. If confidence strong and evidence present: deterministic answer composition (no free-form synthesis)
7. Else if confidence medium: constrained final model synthesis
8. Else: bounded fallback attempts; then unavailable with structured reason
9. Trace emitted with normalized query, routed sources, retries, result counts, top score, answer mode

## 5) Error and Fallback Policy

Rules:
1. Do not return unavailable on first empty result.
2. Execute bounded retry attempts with source alternation.
3. Record every attempt with reason.
4. Return unavailable only with explicit unavailableReason enum.

Retry policy defaults:
- maxAttempts: 3
- Attempt 1: constrained source family from intent
- Attempt 2: adjacent family fallback if confidence permits
- Attempt 3: broad auto retrieval with contamination penalties still active

## 6) Compatibility Strategy

1. Keep function names exported by lib/server/site-api-service.ts during migration.
2. Keep resolveToolCalls signature in lib/server/function-calling-handler.ts while internals evolve.
3. Add compatibility request parser in app/api/chat/site/route.ts to tolerate legacy widget payload variants.
4. Keep response body/stream behavior stable for widget clients.

## 7) Performance and Safety Constraints

1. Keep existing fetch timeout and retry bounds unless explicitly tuned.
2. Prevent unbounded backfill during online requests.
3. Preserve rate limiting behavior in lib/server/rate-limiter.ts.
4. Avoid introducing new external dependencies in PR1-PR3 unless strictly necessary.

## 8) Planned Module Ownership

- Route/API owner: app/api/chat/site/route.ts
- Orchestration owner: lib/server/function-calling-handler.ts and lib/server/retrieval-orchestrator.ts
- Retrieval owner: lib/server/site-api-service.ts and source-adapters
- Knowledge owner: lib/server/knowledge/*
- Composition owner: lib/server/evidence-extractor.ts
- Observability owner: lib/server/observability/chat-trace.ts

## 9) Open Technical Decisions (to resolve in PR2/PR3)

1. Whether retrieval orchestrator runs before tool-calling loop for all grounded requests.
2. Whether to unify knowledge retrieval and API retrieval under one score scale immediately or via adapter bridge.
3. Whether to expose debug trace via optional response header for non-production environments.

## 10) Deliverables by Phase

- PR1:
  - Structured trace helper and integration
  - Deterministic grounded answer mode and answer-mode logging
  - Retry-before-unavailable guard for no-result tool outcomes

- PR2:
  - RetrievalOrchestrator module and plan execution

- PR3:
  - Source adapters and service-facade delegation

- PR4:
  - QueryIntent model and routing matrix replacing distributed heuristic branches

- PR5:
  - Confidence-based fallback policy and rejection taxonomy
