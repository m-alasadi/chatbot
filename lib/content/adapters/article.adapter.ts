import type { ContentItem } from "../types"

function pickFirstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }
  return ""
}

function extractTags(article: any): string[] {
  const tagsSource = article?.tags || article?.categories || article?.kftags

  if (!Array.isArray(tagsSource)) {
    return []
  }

  return tagsSource
    .map((tag: any) => {
      if (typeof tag === "string") return tag
      return pickFirstString(tag?.title, tag?.name, tag?.label)
    })
    .filter((value: string) => value.length > 0)
}

export function mapArticleToContentItem(article: any): ContentItem {
  return {
    id: String(article?.id ?? ""),
    type: "article",
    source: "articles_api",
    language: "ar",
    title: pickFirstString(article?.title, article?.name, article?.headline),
    summary: pickFirstString(article?.summary, article?.description, article?.excerpt),
    content: pickFirstString(article?.content, article?.body, article?.description),
    url: pickFirstString(article?.url, article?.link, article?.permalink),
    image: pickFirstString(article?.image, article?.image_url, article?.thumbnail),
    publishedAt: pickFirstString(article?.published_at, article?.created_at, article?.date),
    tags: extractTags(article),
    metadata: {
      category: pickFirstString(article?.category, article?.category_name),
      author: pickFirstString(article?.author, article?.author_name)
    },
    raw: article
  }
}

export function mapArticlesToContentItems(articles: any[]): ContentItem[] {
  return articles.map(mapArticleToContentItem)
}
