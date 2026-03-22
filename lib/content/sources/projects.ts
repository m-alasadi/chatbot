import { sanitizeAPIResponse } from "../../server/data-sanitizer"
import { getSiteAPIConfig } from "../../server/site-api-config"

const DEFAULT_PROJECTS_ENDPOINT = "/allProjects"

function normalizeProjectsPayload(data: any): any[] {
  if (Array.isArray(data)) {
    return data
  }

  if (data && typeof data === "object") {
    return Object.entries(data).map(([key, value], index) => ({
      id: String(index + 1),
      name: key,
      description: typeof value === "string" ? value : JSON.stringify(value),
      address: "",
      sections: [{ id: 1, name: "قاموس ترجمة" }],
      created_at: null,
      _rawValue: value
    }))
  }

  return []
}

export async function fetchRawProjects(): Promise<any[]> {
  const config = getSiteAPIConfig()
  const endpoint = process.env.SITE_PROJECTS_ENDPOINT || DEFAULT_PROJECTS_ENDPOINT
  const isAbsoluteEndpoint = /^https?:\/\//i.test(endpoint)
  const baseUrl = config.baseUrl.replace(/\/+$/, "")
  const normalizedEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`
  const url = isAbsoluteEndpoint ? endpoint : `${baseUrl}${normalizedEndpoint}`

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Language": "ar"
      }
    })

    if (!response.ok) {
      return []
    }

    const data = await response.json()
    const sanitized = sanitizeAPIResponse(data)
    return normalizeProjectsPayload(sanitized)
  } catch {
    return []
  }
}
