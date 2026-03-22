import type { ContentItem } from "../types"
import { mapArticlesToContentItems } from "../adapters/article.adapter"
import { mapProjectsToContentItems } from "../adapters/project.adapter"
import { fetchRawArticles } from "../sources/articles"
import { fetchRawProjects } from "../sources/projects"

export async function getProjectContentItems(): Promise<ContentItem[]> {
  const rawProjects = await fetchRawProjects()
  return mapProjectsToContentItems(rawProjects)
}

export async function getProjectContentItemById(id: string): Promise<ContentItem | null> {
  const items = await getProjectContentItems()
  return items.find(item => item.id === String(id)) || null
}

export async function getArticleContentItems(): Promise<ContentItem[]> {
  const rawArticles = await fetchRawArticles()
  return mapArticlesToContentItems(rawArticles)
}

export async function getArticleContentItemById(id: string): Promise<ContentItem | null> {
  const items = await getArticleContentItems()
  return items.find(item => item.id === String(id)) || null
}
