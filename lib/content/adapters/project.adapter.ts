import type { ContentItem } from "../types"

export function mapProjectToContentItem(project: any): ContentItem {
  const tags = Array.isArray(project?.kftags)
    ? project.kftags
        .map((tag: any) => tag?.title || tag?.name)
        .filter((v: unknown): v is string => typeof v === "string" && v.length > 0)
    : []

  return {
    id: String(project?.id ?? ""),
    type: "project",
    source: "projects_api",
    language: "ar",
    title: project?.name || "",
    summary: project?.description || "",
    content: project?.description || "",
    publishedAt: project?.created_at,
    tags,
    metadata: {
      sections: project?.sections,
      address: project?.address,
      propertiesCount: Array.isArray(project?.properties) ? project.properties.length : 0
    },
    raw: project
  }
}

export function mapProjectsToContentItems(projects: any[]): ContentItem[] {
  return projects.map(mapProjectToContentItem)
}
