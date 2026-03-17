import { sanitizeAPIResponse } from "../../server/data-sanitizer"
import { getSiteAPIConfig } from "../../server/site-api-config"

const ARTICLES_ENDPOINT = "/allArticles"

export async function fetchRawArticles(): Promise<any[]> {
  try {
    const config = getSiteAPIConfig()

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Language": "ar"
    }

    if (config.token) {
      headers.Authorization = `Bearer ${config.token}`
    }

    const response = await fetch(`${config.baseUrl}${ARTICLES_ENDPOINT}`, {
      method: "GET",
      headers
    })

    if (!response.ok) {
      console.warn(
        "[fetchRawArticles] API response not ok:",
        response.status,
        response.statusText
      )
      return []
    }

    const data = await response.json()
    const sanitized = sanitizeAPIResponse(data)

    return Array.isArray(sanitized) ? sanitized : []
  } catch (error: any) {
    console.warn("[fetchRawArticles] failed, returning empty array:", error?.message || error)
    return []
  }
}
