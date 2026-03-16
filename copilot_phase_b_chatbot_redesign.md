interface CachePayload<T> {
  data: T
  cachedAt: number
}# Phase B — System Redesign Blueprint for m-alasadi/chatbot

This phase is based on the approved Phase A architecture report for the current repository.

Repository:
m-alasadi/chatbot

Current verified baseline:
- Next.js 14 App Router
- `/api/chat/site` Edge route
- OpenAI Function Calling
- External projects API
- In-memory cache
- Single-domain project search
- Standalone embeddable widget

IMPORTANT:
Do not modify source code in this phase.
Do not generate implementation files.
This phase is architecture and migration design only.

---

## OBJECTIVE

Design the target architecture for evolving the current chatbot from a single-domain "projects chatbot" into a broader multi-domain Alkafeel chatbot that can safely support:

- PROJECTS
- ARTICLES
- NEWS
- DICTIONARY
- VIDEOS
- GENERAL_SITE_INFO

The redesign must preserve the current working behavior while enabling incremental migration.

---

## REQUIRED OUTPUT FILE

Generate exactly one file:

SYSTEM_REDESIGN_BLUEPRINT.md

---

## REQUIRED SECTIONS

### 1. Current Baseline Constraints
Summarize the architectural constraints inherited from the current system:
- single-domain tools
- one external API
- in-memory cache
- Edge runtime limitations
- Arabic-first prompt design
- duplicated categories
- tool-calling flow

### 2. Target Architecture
Design a target architecture with clear layers such as:
- app/api/
- lib/chat/
- lib/providers/
- lib/routing/
- lib/language/
- lib/normalizers/
- lib/answers/
- lib/config/
- lib/cache/

For each proposed layer:
- purpose
- what current code would remain
- what new responsibilities it would own

### 3. New Request Lifecycle
Design the future request flow:

User
→ Widget/UI
→ API Route
→ Request Validator
→ Language Resolver
→ Query Classifier
→ Source Router
→ Domain Provider
→ Normalizer
→ Answer Builder
→ Final LLM step or direct response
→ Streamed response

Explain each step.

### 4. Domain Model
Define the target content domains:
- PROJECTS
- ARTICLES
- NEWS
- DICTIONARY
- VIDEOS
- GENERAL_SITE_INFO

For each domain explain:
- likely source
- expected query types
- retrieval style
- answer style
- fallback behavior

### 5. Language Strategy
Design a complete language strategy covering:
- locale source from route/widget/request
- propagation into providers
- Accept-Language usage
- Arabic/English content isolation
- default fallback rules
- preventing mixed-language responses

### 6. Query Classification Strategy
Design a higher-level query classification model for the future system.
Suggested classes:
- GREETING
- GENERAL_HELP
- PROJECT_QUERY
- ARTICLE_QUERY
- NEWS_QUERY
- DICTIONARY_QUERY
- VIDEO_QUERY
- CATEGORY_QUERY
- LATEST_CONTENT_QUERY
- CONTACT_QUERY
- OUT_OF_SCOPE
- UNKNOWN

For each class explain:
- meaning
- examples
- handling path

### 7. Source Routing Strategy
Design routing rules for deciding which provider(s) are used.
Must include:
- priority order
- ambiguity handling
- single-provider path
- multi-provider fallback path
- no-results fallback path

### 8. Provider Architecture
Define a provider abstraction for all future domains.

Suggested interface ideas:
- search(query, options)
- getById(id, options)
- getLatest(options)
- getCategories(options)
- getStatistics(options)
- normalize(raw)

Explain how the current `site-api-service.ts` could become `ProjectsProvider`.

### 9. Normalized Content Model
Define one normalized internal content shape for all domains with fields such as:
- id
- type
- language
- title
- summary
- fullText
- url
- publishedAt
- category
- tags
- metadata
- raw

### 10. Answer Generation Strategy
Design how answers should be built:
- direct factual answer
- result list
- latest items summary
- category listing
- dictionary explanation
- insufficient data response
- source attribution style

### 11. Cache and Performance Strategy
Design the future cache approach for multi-domain support.
Include:
- what can remain in-memory temporarily
- what should move to shared storage later
- cache keys by domain/language
- invalidation strategy
- refresh strategy

### 12. Migration Plan
Design an incremental migration plan with phases.

Must explain:
1. what stays unchanged first
2. how Projects stays working
3. how providers are introduced one by one
4. how routing evolves without breaking `/api/chat/site`
5. when to clean dependencies
6. when to unify categories
7. when to improve search

### 13. Refactor Priorities
Rank the top implementation priorities after this design phase.

---

## RULES

- Base everything on the approved current architecture
- Do not propose a full rewrite from scratch
- Prefer incremental migration
- Preserve existing widget and API behavior
- Keep the design practical for this repository