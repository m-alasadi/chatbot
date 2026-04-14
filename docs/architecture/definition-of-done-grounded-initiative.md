# Definition of Done: Grounded Orchestration Initiative (PR1-PR5)

## A) Architecture Completion

- [ ] Query understanding is implemented as explicit typed model, not scattered keyword branches
- [ ] Retrieval orchestration exists as dedicated module with bounded attempts
- [ ] Source adapters are extracted and used behind stable service facade
- [ ] Ranking emits confidence and rejection reasons in unified shape
- [ ] Answer composition mode is explicit: deterministic grounded vs constrained synthesis vs unavailable

## B) Functional Reliability

- [ ] Same-query repeatability target met on evaluation set
- [ ] Retry-before-unavailable policy enforced in runtime
- [ ] Cross-content contamination reduced for constrained intent queries
- [ ] Arabic intent robustness validated across phrasing variants and normalized forms

## C) Observability

- [ ] Structured trace exists for every production request
- [ ] Trace includes all required fields:
  - [ ] normalized_query
  - [ ] routed_source (or source_attempts)
  - [ ] retry_attempts
  - [ ] result_counts
  - [ ] top_score
  - [ ] answer_mode
  - [ ] unavailable_reason (when applicable)
- [ ] Trace IDs allow correlating route, orchestration, and retrieval events

## D) Compatibility and Safety

- [ ] POST /api/chat/site contract remains compatible
- [ ] Existing tool names remain compatible
- [ ] executeToolByName facade remains compatible during migration
- [ ] Widget clients remain functional:
  - [ ] components/ChatWidget.tsx
  - [ ] public/widget.js
  - [ ] public/widget-loader.js
- [ ] Rate limiting and sanitization behavior preserved

## E) Code Health

- [ ] Compile/lint errors resolved in touched files
- [ ] Duplicate Arabic normalization logic consolidated via shared helper
- [ ] Monolithic modules reduced with clear ownership boundaries
- [ ] Prompt file no longer carries routing responsibility that belongs to runtime

## F) Testing and Evaluation

- [ ] Determinism tests added and passing
- [ ] Retry-before-unavailable tests added and passing
- [ ] Source precision tests for video/news/sermon/history added and passing
- [ ] Arabic variant intent tests added and passing
- [ ] Updated integration tests reflect actual streaming response behavior
- [ ] Baseline vs after metrics documented for each PR

## G) Operational Readiness

- [ ] Rollout plan documented with staged verification
- [ ] Non-prod validation completed
- [ ] Production monitoring dashboard/queries updated for new trace fields
- [ ] Rollback path documented and tested

## H) Documentation

- [ ] ADR committed and referenced from architecture docs
- [ ] System design spec reflects implemented module boundaries
- [ ] PR1-PR5 issue links and status kept current
- [ ] README sections updated to match actual runtime behavior
