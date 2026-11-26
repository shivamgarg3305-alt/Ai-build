/**
 * The ONE place provider defaults live. Model names are configuration (GEMINI_MODEL), never hard-coded
 * anywhere else. Verify the default is available to your key and quota in Google AI Studio: Google's
 * catalog and free-tier availability change.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
export const GEMINI_API_VERSION = 'v1beta';

/** Shown to the owner next to the conversation. Deliberately conservative: it assumes the unpaid terms. */
export const GEMINI_DATA_NOTICE =
  "Messages are sent to Google's Gemini API. Under Google's unpaid-tier terms they may be used to improve Google's products and read by human reviewers. Do not enter sensitive or confidential information.";

/**
 * disabled            AI_ENABLED is not true: no request ever leaves the server.
 * missing_api_key     enabled, but GEMINI_API_KEY is not set.
 * terms_not_reviewed  enabled and keyed, but the owner has not confirmed GEMINI_TERMS_REVIEWED=true.
 * active              all three conditions are met.
 */
export type AiActivation = 'disabled' | 'missing_api_key' | 'terms_not_reviewed' | 'active';

export interface AiConfig {
  provider: 'gemini';
  activation: AiActivation;
  /** Server-side secret. Never serialised into a response or a log (the logger redacts apiKey). */
  apiKey: string | undefined;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  temperature: number;
  maxOutputTokens: number;
  context: { maxMessages: number; maxChars: number };
  limits: { requestsPerMinute: number; requestsPerDay: number; tokensPerDay: number };
  quotaTimeZone: string;
}
