/**
 * Site API Configuration
 * Server-side only - never expose to client
 */

export interface SiteAPIConfig {
  baseUrl: string
  token: string | null
  openaiModel: string
  acceptLanguage: string
  allProjectsEndpoint: string
  sourceEndpoints: Record<string, string>
}

/**
 * Get Site API configuration from environment variables
 * This function should only be called on the server-side
 */
export function getSiteAPIConfig(): SiteAPIConfig {
  const baseUrl = process.env.SITE_API_BASE_URL
  const token = process.env.SITE_API_TOKEN || null
  const openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini"
  const acceptLanguage = process.env.SITE_API_ACCEPT_LANGUAGE || "ar"
  const allProjectsEndpoint = process.env.SITE_API_ALL_PROJECTS_ENDPOINT || "/allProjects"
  const sourceEndpoints: Record<string, string> = {
    articles_latest:
      process.env.SITE_API_ARTICLES_ENDPOINT ||
      "/alkafeel_back_test/api/v1/articles/GetLast/16/all?page=1",
    videos_latest:
      process.env.SITE_API_VIDEOS_LATEST_ENDPOINT ||
      "/alkafeel_back_test/api/v1/videos/latest/16?page=1",
    videos_categories:
      process.env.SITE_API_VIDEOS_CATEGORIES_ENDPOINT ||
      "/alkafeel_back_test/api/v1/videos/getCats",
    videos_by_category:
      process.env.SITE_API_VIDEOS_BY_CATEGORY_ENDPOINT ||
      "/alkafeel_back_test/api/v1/videos/ByCat/{catId}/16?page=1",
    shrine_history_sections:
      process.env.SITE_API_SHRINE_HISTORY_SECTIONS_ENDPOINT ||
      "/alkafeel_back_test/api/v1/alkafeel-histories/getOtherSec",
    shrine_history_by_section:
      process.env.SITE_API_SHRINE_HISTORY_BY_SECTION_ENDPOINT ||
      "/alkafeel_back_test/api/v1/alkafeel-histories/getBySecId/{secId}",
    abbas_history_by_id:
      process.env.SITE_API_ABBAS_HISTORY_BY_ID_ENDPOINT ||
      "/alkafeel_back_test/api/v1/abbas-histories/getById/{id}",
    lang_words_ar:
      process.env.SITE_API_LANG_WORDS_AR_ENDPOINT ||
      "/alkafeel_back_test/api/v1/lang/getWord/ar",
    friday_sermons:
      process.env.SITE_API_FRIDAY_SERMONS_ENDPOINT ||
      "/alkafeel_back_test/api/v1/videos/ByCat/35c0c/16?page=1",
    wahy_friday:
      process.env.SITE_API_WAHY_FRIDAY_ENDPOINT ||
      "/alkafeel_back_test/api/v1/videos/ByCat/0b336/16?page=1"
  }

  if (!baseUrl) {
    throw new Error(
      "SITE_API_BASE_URL is not configured. Please set it in your .env.local file."
    )
  }

  return {
    baseUrl,
    token,
    openaiModel,
    acceptLanguage,
    allProjectsEndpoint,
    sourceEndpoints
  }
}

/**
 * Resolve endpoint template placeholders safely.
 */
export function fillEndpointTemplate(
  endpoint: string,
  replacements: Record<string, string | number>
): string {
  let resolved = endpoint
  Object.entries(replacements).forEach(([key, value]) => {
    resolved = resolved.replace(`{${key}}`, encodeURIComponent(String(value)))
  })
  return resolved
}

/**
 * Get OpenAI model from environment variable
 * Falls back to gpt-4o if not set
 */
export function getOpenAIModel(): string {
  return process.env.OPENAI_MODEL || "gpt-4o-mini"
}

/**
 * Check if Site API is properly configured
 */
export function isSiteAPIConfigured(): boolean {
  return Boolean(process.env.SITE_API_BASE_URL)
}
