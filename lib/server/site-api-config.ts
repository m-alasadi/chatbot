/**
 * Site API Configuration
 * Server-side only - never expose to client
 */

export interface SiteAPIConfig {
  baseUrl: string
  token: string | null
  openaiModel: string
}

/**
 * Get Site API configuration from environment variables
 * This function should only be called on the server-side
 */
export function getSiteAPIConfig(): SiteAPIConfig {
  const baseUrl = process.env.SITE_API_BASE_URL
  const token = process.env.SITE_API_TOKEN || null
  const openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini"

  if (!baseUrl) {
    throw new Error(
      "SITE_API_BASE_URL is not configured. Please set it in your .env.local file."
    )
  }

  return {
    baseUrl,
    token,
    openaiModel
  }
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
