export interface RuntimeRequestStart {
  traceId: string
  queryClass: string
}

export interface RuntimeRequestFinish {
  traceId: string
  totalLatencyMs: number
  answerMode?: string
  unavailableReason?: string
  routedSource?: string
}

export interface RuntimeOrchestratorMetric {
  traceId?: string
  latencyMs: number
  retryCount: number
  budgetExhausted: boolean
  fallbackApplied: boolean
  routedSource?: string
  unavailableReason?: string
}

export interface RuntimeSourceFetchMetric {
  traceId?: string
  source: string
  endpoint: string
  durationMs: number
  success: boolean
  retryCount: number
  timedOut: boolean
}

interface ActiveRequestMetric {
  startedAt: number
  queryClass: string
  sourceFetchLatencyMs: number
  sourceFetchCount: number
  sourceFetchTimeouts: number
  sourceFetchRetries: number
  sourceSelection?: string
  unavailableReason?: string
  orchestratorLatencyMs?: number
  orchestratorRetryCount?: number
  orchestratorBudgetExhausted?: boolean
}

interface RuntimeRollingMetrics {
  totalRequests: number
  unavailableResponses: number
  totalRequestLatencyMs: number
  totalOrchestratorLatencyMs: number
  orchestratorSamples: number
  totalSourceFetchLatencyMs: number
  sourceFetchSamples: number
  retryCountTotal: number
  timeoutCountTotal: number
  budgetExhaustionCount: number
  sourceSelectionDistribution: Record<string, number>
  queryClassDistribution: Record<string, number>
  unavailableReasonDistribution: Record<string, number>
}

const activeRequests = new Map<string, ActiveRequestMetric>()

const rollingMetrics: RuntimeRollingMetrics = {
  totalRequests: 0,
  unavailableResponses: 0,
  totalRequestLatencyMs: 0,
  totalOrchestratorLatencyMs: 0,
  orchestratorSamples: 0,
  totalSourceFetchLatencyMs: 0,
  sourceFetchSamples: 0,
  retryCountTotal: 0,
  timeoutCountTotal: 0,
  budgetExhaustionCount: 0,
  sourceSelectionDistribution: {},
  queryClassDistribution: {},
  unavailableReasonDistribution: {}
}

const LOG_EVERY_N_REQUESTS = Number(process.env.RUNTIME_METRICS_LOG_EVERY || 25)

function bump(map: Record<string, number>, key: string | undefined): void {
  const safeKey = String(key || "unknown")
  map[safeKey] = (map[safeKey] || 0) + 1
}

function asInt(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value))
}

export function startRuntimeRequestMetrics(input: RuntimeRequestStart): void {
  const metric: ActiveRequestMetric = {
    startedAt: Date.now(),
    queryClass: input.queryClass,
    sourceFetchLatencyMs: 0,
    sourceFetchCount: 0,
    sourceFetchTimeouts: 0,
    sourceFetchRetries: 0
  }
  activeRequests.set(input.traceId, metric)
}

export function recordOrchestratorMetrics(metric: RuntimeOrchestratorMetric): void {
  rollingMetrics.totalOrchestratorLatencyMs += asInt(metric.latencyMs)
  rollingMetrics.orchestratorSamples += 1
  rollingMetrics.retryCountTotal += Math.max(0, metric.retryCount)
  if (metric.budgetExhausted) {
    rollingMetrics.budgetExhaustionCount += 1
  }

  if (metric.traceId && activeRequests.has(metric.traceId)) {
    const req = activeRequests.get(metric.traceId)!
    req.orchestratorLatencyMs = asInt(metric.latencyMs)
    req.orchestratorRetryCount = Math.max(0, metric.retryCount)
    req.orchestratorBudgetExhausted = metric.budgetExhausted
    if (metric.routedSource) req.sourceSelection = metric.routedSource
    if (metric.unavailableReason) req.unavailableReason = metric.unavailableReason
  }
}

export function recordSourceFetchMetrics(metric: RuntimeSourceFetchMetric): void {
  rollingMetrics.totalSourceFetchLatencyMs += asInt(metric.durationMs)
  rollingMetrics.sourceFetchSamples += 1
  rollingMetrics.retryCountTotal += Math.max(0, metric.retryCount)
  if (metric.timedOut) {
    rollingMetrics.timeoutCountTotal += 1
  }

  if (metric.traceId && activeRequests.has(metric.traceId)) {
    const req = activeRequests.get(metric.traceId)!
    req.sourceFetchLatencyMs += asInt(metric.durationMs)
    req.sourceFetchCount += 1
    req.sourceFetchRetries += Math.max(0, metric.retryCount)
    if (metric.timedOut) {
      req.sourceFetchTimeouts += 1
    }
  }
}

export function finishRuntimeRequestMetrics(input: RuntimeRequestFinish): void {
  const req = activeRequests.get(input.traceId)
  rollingMetrics.totalRequests += 1
  rollingMetrics.totalRequestLatencyMs += asInt(input.totalLatencyMs)

  if (req) {
    bump(rollingMetrics.queryClassDistribution, req.queryClass)
    if (req.sourceSelection || input.routedSource) {
      bump(rollingMetrics.sourceSelectionDistribution, req.sourceSelection || input.routedSource)
    }
  }

  const unavailableReason = input.unavailableReason || req?.unavailableReason
  if (unavailableReason) {
    rollingMetrics.unavailableResponses += 1
    bump(rollingMetrics.unavailableReasonDistribution, unavailableReason)
  }

  if (rollingMetrics.totalRequests % Math.max(1, LOG_EVERY_N_REQUESTS) === 0) {
    const avgReq = rollingMetrics.totalRequests > 0
      ? Math.round(rollingMetrics.totalRequestLatencyMs / rollingMetrics.totalRequests)
      : 0
    const avgOrchestrator = rollingMetrics.orchestratorSamples > 0
      ? Math.round(rollingMetrics.totalOrchestratorLatencyMs / rollingMetrics.orchestratorSamples)
      : 0
    const avgSourceFetch = rollingMetrics.sourceFetchSamples > 0
      ? Math.round(rollingMetrics.totalSourceFetchLatencyMs / rollingMetrics.sourceFetchSamples)
      : 0

    console.log("[RuntimeMetrics]", JSON.stringify({
      total_requests: rollingMetrics.totalRequests,
      avg_request_latency_ms: avgReq,
      avg_orchestrator_latency_ms: avgOrchestrator,
      avg_source_fetch_latency_ms: avgSourceFetch,
      retry_count_total: rollingMetrics.retryCountTotal,
      timeout_count_total: rollingMetrics.timeoutCountTotal,
      budget_exhaustion_count: rollingMetrics.budgetExhaustionCount,
      unavailable_response_rate: Number((rollingMetrics.unavailableResponses / Math.max(1, rollingMetrics.totalRequests)).toFixed(4)),
      source_selection_distribution: rollingMetrics.sourceSelectionDistribution,
      query_class_distribution: rollingMetrics.queryClassDistribution,
      unavailable_reason_distribution: rollingMetrics.unavailableReasonDistribution
    }))
  }

  activeRequests.delete(input.traceId)
}

export function getRuntimeMetricsSnapshot(): Record<string, any> {
  const total = Math.max(1, rollingMetrics.totalRequests)
  const avgReq = Math.round(rollingMetrics.totalRequestLatencyMs / total)
  const avgOrchestrator = rollingMetrics.orchestratorSamples > 0
    ? Math.round(rollingMetrics.totalOrchestratorLatencyMs / rollingMetrics.orchestratorSamples)
    : 0
  const avgSourceFetch = rollingMetrics.sourceFetchSamples > 0
    ? Math.round(rollingMetrics.totalSourceFetchLatencyMs / rollingMetrics.sourceFetchSamples)
    : 0

  return {
    total_requests: rollingMetrics.totalRequests,
    avg_request_latency_ms: avgReq,
    avg_orchestrator_latency_ms: avgOrchestrator,
    avg_source_fetch_latency_ms: avgSourceFetch,
    retry_count_total: rollingMetrics.retryCountTotal,
    timeout_count_total: rollingMetrics.timeoutCountTotal,
    budget_exhaustion_count: rollingMetrics.budgetExhaustionCount,
    unavailable_response_rate: Number((rollingMetrics.unavailableResponses / total).toFixed(4)),
    source_selection_distribution: rollingMetrics.sourceSelectionDistribution,
    query_class_distribution: rollingMetrics.queryClassDistribution,
    unavailable_reason_distribution: rollingMetrics.unavailableReasonDistribution
  }
}
