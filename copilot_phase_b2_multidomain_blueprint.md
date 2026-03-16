# Phase B.2 — Multi-Domain Architecture Blueprint

Repository:
m-alasadi/chatbot

This phase extends the approved Phase A audit and the existing Phase B.1 stabilization blueprint.

IMPORTANT:
Do not modify source code.
Do not focus on cache, logging, dependency cleanup, or rate limiting in this phase unless directly relevant.
Those concerns are already covered by Phase B.1.

This phase must focus only on the architectural transformation from a single-domain projects chatbot into a multi-domain Alkafeel chatbot.

---

## OBJECTIVE

Design the architecture required to evolve the chatbot from:
- one domain: PROJECTS

into:
- PROJECTS
- ARTICLES
- NEWS
- DICTIONARY
- VIDEOS
- GENERAL_SITE_INFO

while preserving the current `/api/chat/site` contract and current widget behavior.

---

## REQUIRED OUTPUT FILE

Generate exactly one file:

MULTIDOMAIN_ARCHITECTURE_BLUEPRINT.md

---

## REQUIRED SECTIONS

### 1. Current Limitation Summary
Explain why the current architecture is still single-domain even after Phase B.1 improvements.

### 2. Target Multi-Domain Architecture
Design a target structure for adding multiple domains cleanly.
Suggested layers:
- lib/providers/
- lib/routing/
- lib/language/
- lib/normalizers/
- lib/answers/
- lib/domain/
- lib/query-classification/

### 3. Domain Provider Model
Define providers for:
- ProjectsProvider
- ArticlesProvider
- NewsProvider
- DictionaryProvider
- VideosProvider
- GeneralInfoProvider

For each provider explain:
- likely API source
- methods
- normalization responsibility
- caching responsibility

### 4. Query Classification Model
Define future query classes:
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

### 5. Source Routing Model
Design how the system decides which provider handles a query.
Include:
- direct routing
- ambiguous routing
- fallback routing
- multi-provider routing

### 6. Language Architecture
Design language flow for multilingual support:
- locale source
- widget-provided language
- route locale
- Accept-Language propagation
- provider-level language handling
- preventing mixed-language output

### 7. Normalized Content Model
Define one internal content schema shared by all domains.

Suggested fields:
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

### 8. Answer Building Strategy
Design how answers differ by domain:
- factual answer
- latest items
- result list
- dictionary explanation
- article/news summary
- insufficient info response

### 9. Tooling / LLM Strategy
Explain whether the future architecture should:
- keep OpenAI function calling as-is
- extend tools by domain
- or introduce pre-routing before tool calling

Be practical and incremental.

### 10. Migration Plan
Explain:
1. how Projects stays working unchanged
2. how the first non-project provider is added
3. how routing evolves safely
4. how prompts and tools evolve without breaking current behavior

### 11. Top Implementation Priorities
Rank the practical implementation order for multi-domain expansion.

---

## RULES

- Base everything on the approved Phase A report
- Treat Phase B.1 as already covering technical hardening
- Focus only on multi-domain evolution
- Do not propose a full rewrite
- Prefer incremental migration