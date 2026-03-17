import { NextResponse } from "next/server"
import {
  getArticleContentItems,
  getProjectContentItems
} from "@/lib/content/services/content-aggregator"

export const dynamic = "force-dynamic"

type DebugContentType = "project" | "article"

function toSafeItems(items: any[]) {
  return items.map(item => ({
    id: item?.id,
    type: item?.type,
    title: item?.title,
    summary: item?.summary,
    publishedAt: item?.publishedAt,
    image: item?.image,
    url: item?.url,
    tags: item?.tags,
    metadata: item?.metadata
  }))
}

function parseLimit(value: string | null): number {
  if (!value) return 10

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 10

  return Math.min(Math.floor(parsed), 100)
}

function parseType(value: string | null): DebugContentType | null {
  if (value === "project" || value === "article") {
    return value
  }

  return null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const type = parseType(searchParams.get("type"))
  const limit = parseLimit(searchParams.get("limit"))

  if (!type) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid type. Supported values: project, article"
      },
      { status: 400 }
    )
  }

  try {
    const items =
      type === "project"
        ? await getProjectContentItems()
        : await getArticleContentItems()

    const limited = items.slice(0, limit)

    return NextResponse.json({
      success: true,
      type,
      total: limited.length,
      items: toSafeItems(limited)
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        type,
        error: error?.message || "Unknown error"
      },
      { status: 500 }
    )
  }
}
