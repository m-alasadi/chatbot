# GitHub Issue Breakdown (PR1-PR5)

## Issue 1: PR1 - Deterministic Grounded Mode, Retry Before Unavailable, Structured Traces

- Type: Feature
- Priority: P0
- Labels: architecture, backend, reliability, grounding
- Depends on: none

## Description
Implement minimal-risk server-side improvements to stabilize grounded responses and avoid premature unavailable outputs.

## Scope
- app/api/chat/site/route.ts
- lib/server/function-calling-handler.ts
- lib/server/site-api-service.ts
- lib/server/evidence-extractor.ts
- lib/server/system-prompts.ts
- components/ChatWidget.tsx
- tests/run-tests.js
- new lib/server/observability/chat-trace.ts

## Tasks
- Add structured trace logging fields
- Add bounded retry before empty_results/unavailable
- Make grounded answer composition deterministic
- Keep endpoint/tool compatibility
- Add PR1 tests

## Acceptance
- PR1 acceptance criteria in docs/architecture/pr1-implementation-plan.md

---

## Issue 2: PR2 - Retrieval Orchestrator Abstraction

- Type: Feature
- Priority: P0
- Labels: architecture, backend, retrieval
- Depends on: Issue 1

## Description
Introduce retrieval orchestrator to centralize source planning, retries, and fallback broadening.

## Scope
- new lib/server/retrieval-orchestrator.ts
- lib/server/function-calling-handler.ts
- lib/server/site-api-service.ts

## Tasks
- Define RetrievalPlan and OrchestratorResult interfaces
- Implement bounded multi-attempt search strategy
- Move retry/fallback policy out of scattered branches
- Emit orchestrator-level traces

## Acceptance
- No direct unavailable before orchestrator attempts exhausted
- Orchestrator events present in logs

---

## Issue 3: PR3 - Source Adapter Extraction

- Type: Refactor
- Priority: P1
- Labels: architecture, refactor, retrieval
- Depends on: Issue 2

## Description
Extract source-specific logic from site-api-service monolith into source adapters.

## Scope
- new lib/server/source-adapters/*
- lib/server/site-api-service.ts facade updates
- related tests

## Tasks
- Introduce SourceAdapter interface
- Implement adapters for news/video/history/abbas/sermon/language
- Keep executeToolByName as compatibility facade
- Add adapter unit tests

## Acceptance
- All existing tools return equivalent payload shape
- Adapter tests green

---

## Issue 4: PR4 - Typed Query Understanding and Routing Matrix

- Type: Feature
- Priority: P0
- Labels: architecture, nlp, arabic
- Depends on: Issue 3

## Description
Replace distributed keyword forcing with typed QueryIntent and routing matrix.

## Scope
- new lib/server/query-understanding.ts
- lib/server/function-calling-handler.ts
- lib/server/knowledge/knowledge-search.ts alignment

## Tasks
- Define QueryIntent model
- Implement feature-based intent inference
- Replace detectForcedToolIntent/related branching with matrix policy
- Add intent consistency tests for Arabic phrasing variants

## Acceptance
- Routing decisions derived from QueryIntent
- Reduced keyword-fragility in test set

---

## Issue 5: PR5 - Confidence-Based Fallback and Rejection Policy

- Type: Feature
- Priority: P0
- Labels: architecture, reliability, ranking
- Depends on: Issue 4

## Description
Standardize confidence scoring outputs and enforce confidence-based fallback/rejection before unavailable.

## Scope
- lib/server/site-api-service.ts
- lib/server/knowledge/knowledge-search.ts
- lib/server/function-calling-handler.ts
- new/shared ranking confidence types

## Tasks
- Introduce unified RankedResult + confidence + rejection reasons
- Add cross-content contamination penalties
- Implement unavailable reason taxonomy
- Add evaluation tests for constrained content-type queries

## Acceptance
- False unavailable reduced from baseline set
- Cross-content contamination reduced on constrained prompts

---

## Tracking Notes

- Use one umbrella milestone: Grounded Orchestration Initiative
- Each issue should include before/after metrics from the same Arabic evaluation set
- Keep backward compatibility checks mandatory until completion of PR5
