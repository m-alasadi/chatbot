export type ContentType = "project" | "article"

export interface ContentItem {
  id: string
  type: ContentType
  source: string
  language: string

  title: string
  summary?: string
  content?: string

  url?: string
  image?: string
  publishedAt?: string

  tags?: string[]
  metadata?: Record<string, unknown>

  raw?: unknown
}
