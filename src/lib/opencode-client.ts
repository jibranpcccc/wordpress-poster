import { OpenAI } from 'openai';

// Disable TLS verification locally to prevent SSL proxy/security intercepts from breaking requests on team laptops
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// The hardcoded working OpenCode API key — used as guaranteed fallback on any laptop
const OPENCODE_DEFAULT_KEY = 'sk-X8nDa9FRQp3nKXTPCvEJx0BXGDunw4xSDBR1ksclmKU3kkRgt8iDuRd72YZXaeIf';
const OPENCODE_BASE_URL = 'https://opencode.ai/zen/v1';

export function getApiKey(): string {
  // ONLY load OPENCODE_ZEN_API_KEY — never read OPENAI_API_KEY or OPENAI_API_BASE
  // Those system variables belong to other tools and must NEVER override our OpenCode key
  const envKey = process.env.OPENCODE_ZEN_API_KEY;
  if (envKey && envKey.trim().startsWith('sk-')) {
    return envKey.trim();
  }
  return OPENCODE_DEFAULT_KEY;
}

export function getOpenCodeClient(customApiKey?: string) {
  const apiKey = customApiKey || getApiKey();
  // NEVER use process.env.OPENAI_API_BASE — strictly connect to OpenCode only
  return new OpenAI({
    apiKey: apiKey,
    baseURL: OPENCODE_BASE_URL,
  });
}
