import type { ContentItem } from "../types"

function pickFirstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }
  return ""
}

export function mapArticleToContentItem(article: any): ContentItem {
  const tagsSource = article?.tags || article?.categories || article?.kftags
  const tags = Array.isArray(tagsSource)
    ? tagsSource
        .map((tag: any) => (typeof tag === "string" ? tag : pickFirstString(tag?.title, tag?.name, tag?.label)))
        .filter((v: string) => v.length > 0)
    : []

  return {
    id: String(article?.id ?? ""),
    type: "article",
    source: "articles_api",
    language: "ar",
    title: pickFirstString(article?.title, article?.name, article?.headline),
    summary: pickFirstString(article?.summary, article?.description, article?.excerpt),
    content: pickFirstString(article?.content, article?.body, article?.description),
    publishedAt: pickFirstString(article?.published_at, article?.created_at, article?.date),
    image: pickFirstString(article?.image, article?.image_url, article?.thumbnail),
    url: pickFirstString(article?.url, article?.link, article?.permalink),
    tags,
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
