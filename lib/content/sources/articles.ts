import { sanitizeAPIResponse } from "../../server/data-sanitizer"
import { getSiteAPIConfig } from "../../server/site-api-config"

const DEFAULT_ARTICLES_ENDPOINT = "/allArticles"

export async function fetchRawArticles(): Promise<any[]> {
  const config = getSiteAPIConfig()
  const endpoint = process.env.SITE_ARTICLES_ENDPOINT || DEFAULT_ARTICLES_ENDPOINT
  const url = `${config.baseUrl}${endpoint}`

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Language": "ar"
      }
    })

    const contentType = response.headers.get("content-type") || ""
    const responseText = await response.text()

    if (!response.ok) {
      console.error("[fetchRawArticles] HTTP error", {
        url,
        status: response.status,
        statusText: response.statusText,
        contentType,
        bodyPreview: responseText.slice(0, 500)
      })
      return []
    }

    let parsed: unknown
    if (contentType.includes("application/json")) {
      try {
        parsed = JSON.parse(responseText)
      } catch (error: any) {
        console.error("[fetchRawArticles] Invalid JSON response", {
          url,
          contentType,
          error: error?.message,
          bodyPreview: responseText.slice(0, 500)
        })
        return []
      }
    } else {
      console.error("[fetchRawArticles] Unexpected content-type", {
        url,
        contentType,
        bodyPreview: responseText.slice(0, 500)
      })
      return []
    }

    const sanitized = sanitizeAPIResponse(parsed)

    if (!Array.isArray(sanitized)) {
      console.error("[fetchRawArticles] API did not return an array", {
        url,
        responseType: typeof sanitized,
        sample: sanitized && typeof sanitized === "object" ? Object.keys(sanitized as Record<string, unknown>).slice(0, 10) : sanitized
      })
      return []
    }

    return sanitized
  } catch (error: any) {
    console.error("[fetchRawArticles] Request failed", {
      url,
      message: error?.message,
      stack: error?.stack
    })
    return []
  }
}
