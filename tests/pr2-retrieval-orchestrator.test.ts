import assert from "node:assert/strict"
import { orchestrateRetrieval } from "../lib/server/retrieval-orchestrator"
import type { APICallResult } from "../lib/server/site-api-service"
import type { AllowedToolName } from "../lib/server/site-tools-definitions"

type ExecCall = { toolName: AllowedToolName; args: Record<string, any> }

function makeResult(data: any): APICallResult {
  return { success: true, data }
}

async function runTests() {
  await testVideoIntentFirstPassNotNews()
  await testRetryBeforeBroadening()
  await testNoUnavailableBeforeExhaustion()
  await testExplicitSourceRespectedBeforeBroadening()
  await testSearchProjectsOrchestration()
  await testSearchProjectsUsesRetryPolicy()
  console.log("PR2 orchestrator tests passed")
}

async function testVideoIntentFirstPassNotNews() {
  const calls: ExecCall[] = []
  const exec = async (toolName: AllowedToolName, args: Record<string, any>): Promise<APICallResult> => {
    calls.push({ toolName, args })
    return makeResult({
      results: [{ id: "1", source_type: "videos_latest", name: "video" }],
      total: 1,
      top_score: 12,
      source_used: args.source
    })
  }

  const result = await orchestrateRetrieval(
    "search_content",
    { query: "محاضرات الشيخ زمان الحسناوي", source: "auto" },
    { execute: exec }
  )

  assert.ok(result)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args.source, "videos_latest")
  assert.equal(result?.attempts[0].source, "videos_latest")
}

async function testRetryBeforeBroadening() {
  const calls: ExecCall[] = []
  const exec = async (toolName: AllowedToolName, args: Record<string, any>): Promise<APICallResult> => {
    calls.push({ toolName, args })

    if (calls.length === 1) {
      return makeResult({
        results: [],
        total: 0,
        top_score: null,
        source_used: args.source
      })
    }

    return makeResult({
      results: [{ id: "2", source_type: "videos_latest", name: "hit" }],
      total: 1,
      top_score: 9,
      source_used: args.source
    })
  }

  const result = await orchestrateRetrieval(
    "search_content",
    { query: "فيديو عن العتبة", source: "auto" },
    { execute: exec }
  )

  assert.ok(result)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].args.source, "videos_latest")
  assert.equal(calls[1].args.source, "auto")
  assert.equal(result?.fallbackApplied, true)
}

async function testNoUnavailableBeforeExhaustion() {
  const calls: ExecCall[] = []
  const exec = async (toolName: AllowedToolName, args: Record<string, any>): Promise<APICallResult> => {
    calls.push({ toolName, args })
    return makeResult({
      results: [],
      total: 0,
      top_score: null,
      source_used: args.source
    })
  }

  const result = await orchestrateRetrieval(
    "search_content",
    { query: "فيديو نادر جدا", source: "auto" },
    { execute: exec, maxAttempts: 3 }
  )

  assert.ok(result)
  assert.equal(calls.length, 2)
  assert.equal(result?.exhausted, true)
  assert.equal(result?.unavailableReason, "attempts_exhausted")
  assert.equal(result?.attempts.length, calls.length)
}

async function testExplicitSourceRespectedBeforeBroadening() {
  const calls: ExecCall[] = []
  const exec = async (toolName: AllowedToolName, args: Record<string, any>): Promise<APICallResult> => {
    calls.push({ toolName, args })
    if (calls.length === 1) {
      return makeResult({ results: [], total: 0, top_score: null, source_used: args.source })
    }
    return makeResult({
      results: [{ id: "3", source_type: "articles_latest", name: "news item" }],
      total: 1,
      top_score: 5,
      source_used: args.source
    })
  }

  const result = await orchestrateRetrieval(
    "search_content",
    { query: "احدث خبر", source: "articles_latest" },
    { execute: exec, maxAttempts: 3 }
  )

  assert.ok(result)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].args.source, "articles_latest")
  assert.equal(calls[1].args.source, "auto")
}

async function testSearchProjectsOrchestration() {
  const calls: ExecCall[] = []
  const exec = async (toolName: AllowedToolName, args: Record<string, any>): Promise<APICallResult> => {
    calls.push({ toolName, args })
    return makeResult({
      projects: [{ id: "p1", source_type: "articles_latest", name: "project" }],
      total: 1,
      top_score: 11,
      source_used: args.source
    })
  }

  const result = await orchestrateRetrieval(
    "search_projects",
    { query: "مشاريع توسعة العتبة", source: "auto" },
    { execute: exec }
  )

  assert.ok(result)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].toolName, "search_projects")
  assert.equal(result?.resultCount, 1)
}

async function testSearchProjectsUsesRetryPolicy() {
  const calls: ExecCall[] = []
  const exec = async (toolName: AllowedToolName, args: Record<string, any>): Promise<APICallResult> => {
    calls.push({ toolName, args })
    if (calls.length === 1) {
      return makeResult({
        results: [],
        total: 0,
        top_score: null,
        source_used: args.source
      })
    }
    return makeResult({
      results: [{ id: "p1", source_type: "articles_latest", name: "مشروع توسعة" }],
      total: 1,
      top_score: 8,
      source_used: args.source
    })
  }

  const result = await orchestrateRetrieval(
    "search_projects",
    { query: "مشاريع توسعة العتبة", source: "articles_latest" },
    { execute: exec, maxAttempts: 3 }
  )

  assert.ok(result)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].toolName, "search_projects")
  assert.equal(calls[0].args.source, "articles_latest")
  assert.equal(calls[1].args.source, "auto")
}

runTests().catch(err => {
  console.error(err)
  process.exit(1)
})
