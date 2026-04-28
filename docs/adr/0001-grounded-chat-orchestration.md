# ADR 0001: Structured Query Understanding and Retrieval Orchestration for Grounded Arabic Chat

- Status: Accepted
- Date: 2026-04-14
- Owners: Chatbot platform team
- Scope: Server-side chat pipeline for /api/chat/site

## Context

The current pipeline already has strong building blocks:
- API route orchestration in app/api/chat/site/route.ts
- Tool execution and forced intent logic in lib/server/function-calling-handler.ts
- Multi-source retrieval and ranking in lib/server/site-api-service.ts
- Knowledge retrieval and reranking in lib/server/knowledge/*

However, routing logic is distributed across multiple keyword-based functions and answer composition can take multiple stochastic paths. This causes unstable grounding behavior and inconsistent unavailable decisions.

## Decision

Adopt an incremental architecture with five bounded phases (PR1-PR5) that preserves the external API contract while restructuring internals around explicit planning and confidence.

1. Introduce a typed query-understanding result used by orchestration logic (not prompt text) as the source of truth.
2. Introduce a retrieval orchestrator that controls source selection, retries, and fallback before unavailable.
3. Split source-specific behavior into source adapters behind a stable execution facade.
4. Unify ranking/confidence outputs into a single shape consumed by orchestration and answer composition.
5. Prefer deterministic grounded composition when evidence is strong, and only run model synthesis when needed.

## Architectural Rules

1. Runtime orchestration owns routing decisions; prompts do not.
2. Unavailable is emitted only after bounded retry/fallback steps are exhausted.
3. Content-type constraints are hard constraints when confidence is high (for example, video intent should not return news-first answers).
4. Arabic normalization and tokenization utilities must be shared across layers.
5. Existing endpoint and tool names remain backward compatible during migration.

## Compatibility Constraints

- Keep POST /api/chat/site behavior compatible for:
  - components/ChatWidget.tsx request shape
  - public/widget.js and public/widget-loader.js request shape
- Keep existing tool names in lib/server/site-tools-definitions.ts
- Keep executeToolByName in lib/server/site-api-service.ts as compatibility facade during PR1-PR3

## Consequences

Positive:
- Higher answer determinism on grounded paths
- Reduced false unavailable responses via bounded retries
- Better source precision for Arabic content-type requests
- Better observability for triage and evaluation

Trade-offs:
- Additional orchestration code and interfaces
- Slightly higher implementation complexity during transition
- Need to keep temporary compatibility shims until old paths are removed

## Alternatives Considered

1. Prompt-only constraints: rejected as primary approach because runtime still controls retrieval and fallback.
2. Temperature-only reduction: rejected as primary approach because it does not fix routing and confidence issues.
3. Full rewrite: rejected due to production risk and compatibility impact.

## Implementation Sequence

- PR1: Traceability + deterministic grounded composition + retry-before-unavailable guardrails
- PR2: Retrieval orchestrator abstraction
- PR3: Source adapter extraction
- PR4: Typed query-intent routing matrix
- PR5: Confidence-based fallback and rejection policy

## Success Metrics

- Repeatability: same query yields same source plan and answer mode in >= 95% of repeated runs
- False unavailable rate: reduced versus baseline set
- Source precision for constrained Arabic queries: improved versus baseline set
- Trace completeness: normalized query, routed source, retries, result counts, top score present for >= 99% of requests
