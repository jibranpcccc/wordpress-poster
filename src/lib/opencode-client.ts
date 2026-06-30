import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';

let cachedApiKey: string | null = null;

export function getApiKey(): string {
  if (cachedApiKey) return cachedApiKey;

  // 1. Check environment variables
  if (process.env.OPENCODE_ZEN_API_KEY) {
    cachedApiKey = process.env.OPENCODE_ZEN_API_KEY;
    return cachedApiKey;
  }
  if (process.env.OPENAI_API_KEY) {
    cachedApiKey = process.env.OPENAI_API_KEY;
  }

  // 2. Try loading from global .hermes/.env file on Windows
  const hermesEnvPath = 'C:\\Users\\jibra\\.hermes\\.env';
  if (fs.existsSync(hermesEnvPath)) {
    try {
      const content = fs.readFileSync(hermesEnvPath, 'utf8');
      
      // Look for OPENCODE_ZEN_API_KEY
      const zenMatch = content.match(/^OPENCODE_ZEN_API_KEY=(.*)$/m);
      if (zenMatch && zenMatch[1]) {
        cachedApiKey = zenMatch[1].trim();
        return cachedApiKey;
      }
      
      // Fallback: look for OPENCODE_GO_API_KEY or OPENAI_API_KEY
      const goMatch = content.match(/^OPENCODE_GO_API_KEY=(.*)$/m);
      if (goMatch && goMatch[1]) {
        cachedApiKey = goMatch[1].trim();
        return cachedApiKey;
      }
      
      const openaiMatch = content.match(/^OPENAI_API_KEY=(.*)$/m);
      if (openaiMatch && openaiMatch[1]) {
        cachedApiKey = openaiMatch[1].trim();
        return cachedApiKey;
      }
    } catch (e) {
      console.error("Error reading hermes env file:", e);
    }
  }

  return cachedApiKey || '';
}

export function getOpenCodeClient(customApiKey?: string) {
  const apiKey = customApiKey || getApiKey();
  const apiBase = process.env.OPENAI_API_BASE || 'https://opencode.ai/zen/v1';

  return new OpenAI({
    apiKey: apiKey,
    baseURL: apiBase,
  });
}
