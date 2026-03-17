import type { ContentItem, ContentType } from "../types"
import { mapArticleToContentItem, mapArticlesToContentItems } from "../adapters/article.adapter"
import { mapProjectToContentItem, mapProjectsToContentItems } from "../adapters/project.adapter"
import { fetchRawArticles } from "../sources/articles"
import { fetchRawProjects } from "../sources/projects"

export async function getProjectContentItems(): Promise<ContentItem[]> {
  const rawProjects = await fetchRawProjects()
  return mapProjectsToContentItems(rawProjects)
}

export async function getProjectContentItemById(id: string): Promise<ContentItem | null> {
  const rawProjects = await fetchRawProjects()
  const project = rawProjects.find((item: any) => String(item?.id) === String(id))

  if (!project) {
    return null
  }

  return mapProjectToContentItem(project)
}

export async function getArticleContentItems(): Promise<ContentItem[]> {
  const rawArticles = await fetchRawArticles()
  return mapArticlesToContentItems(rawArticles)
}

export async function getArticleContentItemById(id: string): Promise<ContentItem | null> {
  const rawArticles = await fetchRawArticles()
  const article = rawArticles.find((item: any) => String(item?.id) === String(id))

  if (!article) {
    return null
  }

  return mapArticleToContentItem(article)
}

export async function getContentItemsByType(type: ContentType): Promise<ContentItem[]> {
  if (type === "project") {
    return getProjectContentItems()
  }

  return getArticleContentItems()
}
