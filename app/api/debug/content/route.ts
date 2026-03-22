import { NextResponse } from "next/server"
import {
  getArticleContentItems,
  getProjectContentItems
} from "@/lib/content/services/content-aggregator"

type SupportedType = "project" | "article"

function parseType(value: string | null): SupportedType | null {
  if (value === "project" || value === "article") {
    return value
  }
  return null
}

function parseLimit(value: string | null): number {
  if (!value) return 10
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 10
  return Math.min(Math.floor(n), 100)
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

    const sliced = items.slice(0, limit)

    return NextResponse.json({
      success: true,
      type,
      total: sliced.length,
      items: sliced
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
