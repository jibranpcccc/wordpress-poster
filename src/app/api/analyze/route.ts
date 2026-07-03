import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getOpenCodeClient, getApiKey } from '@/lib/opencode-client';
import { db } from '@/lib/db';

export const maxDuration = 60; // Max 60s for Netlify Pro (free plan: 10s, handled by streaming)


function getGeminiKeys(): string[] {
  // Load from environment variable (which is in .env, git-ignored)
  const keys: string[] = [];
  for (let i = 1; i <= 50; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`] || process.env[`GEMINI_API_KEY`];
    if (k) keys.push(k.trim());
  }
  return keys;
}

const GEMINI_KEYS = getGeminiKeys();


function escapeRawNewlinesInJsonString(jsonStr: string): string {
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    if (escape) {
      result += char;
      escape = false;
      continue;
    }
    if (char === '\\') {
      result += char;
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
    }
    if (inString && (char === '\n' || char === '\r')) {
      result += '\\n';
    } else {
      result += char;
    }
  }
  return result;
}

function escapeUnescapedQuotesInJson(jsonStr: string): string {
  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    
    if (escape) {
      result += char;
      escape = false;
      continue;
    }
    
    if (char === '\\') {
      result += char;
      escape = true;
      continue;
    }
    
    if (char === '"') {
      if (!inString) {
        inString = true;
        result += char;
      } else {
        // Lookahead to see if this is truly the end of the string
        let isEndOfString = false;
        let j = i + 1;
        let nextNonWhitespace = '';
        let nextNonWhitespaceAfterComma = '';
        
        while (j < jsonStr.length) {
          const nextChar = jsonStr[j];
          if (/\s/.test(nextChar)) {
            j++;
            continue;
          }
          if (!nextNonWhitespace) {
            nextNonWhitespace = nextChar;
            if (nextChar !== ',') {
              break;
            }
          } else {
            nextNonWhitespaceAfterComma = nextChar;
            break;
          }
          j++;
        }
        
        if (nextNonWhitespace === '}' || nextNonWhitespace === ']' || nextNonWhitespace === ':') {
          isEndOfString = true;
        } else if (nextNonWhitespace === ',') {
          // If it's a comma, it must be followed by a quote (start of next key or array element) or end of block
          if (nextNonWhitespaceAfterComma === '"' || nextNonWhitespaceAfterComma === '}' || nextNonWhitespaceAfterComma === ']') {
            isEndOfString = true;
          }
        }
        
        if (isEndOfString) {
          inString = false;
          result += char;
        } else {
          result += '\\"';
        }
      }
    } else {
      result += char;
    }
  }
  return result;
}

function repairTruncatedJson(jsonStr: string): string {
  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}') {
        if (stack[stack.length - 1] === '{') {
          stack.pop();
        }
      } else if (char === ']') {
        if (stack[stack.length - 1] === '[') {
          stack.pop();
        }
      }
    }
  }

  let repaired = jsonStr;
  if (inString) {
    repaired += '"';
  }

  // Close any unclosed objects or arrays in reverse order
  while (stack.length > 0) {
    const open = stack.pop();
    if (open === '{') {
      repaired += '}';
    } else if (open === '[') {
      repaired += ']';
    }
  }

  return repaired;
}

function cleanJsonString(str: string): string {
  let cleaned = str.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  // If the JSON is truncated (due to token limits), repair the end
  cleaned = repairTruncatedJson(cleaned);

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  // Escape unescaped double quotes inside string values
  cleaned = escapeUnescapedQuotesInJson(cleaned);

  // Repair missing commas between objects in arrays (e.g. } { -> }, {)
  cleaned = cleaned.replace(/\}\s*\{/g, '},{');
  // Repair missing commas between key-value pairs or objects (e.g. } "key" -> }, "key")
  cleaned = cleaned.replace(/\}\s*"/g, '},"');
  cleaned = cleaned.replace(/"\s*\{/g, '",{');
  // Repair missing commas between string literals in arrays (e.g. "item1" "item2" -> "item1", "item2")
  cleaned = cleaned.replace(/"\s*"/g, '", "');

  // Remove trailing commas in arrays and objects
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  
  // Escape raw newlines inside string properties
  return escapeRawNewlinesInJsonString(cleaned);
}

function extractFlexibleJson(rawText: string): any {
  const firstBrace = rawText.indexOf('{');
  const lastBrace = rawText.lastIndexOf('}');
  let jsonString = rawText;
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonString = rawText.substring(firstBrace, lastBrace + 1);
  }

  try {
    const cleaned = cleanJsonString(jsonString);
    return JSON.parse(cleaned);
  } catch (parseErr: any) {
    console.warn("Standard JSON.parse failed. Attempting regex-based field extraction...", parseErr.message);
    
    // Helper to extract a string field
    const extractString = (field: string): string => {
      const match = jsonString.match(new RegExp(`"${field}"\\s*:\\s*"`));
      if (!match) return '';
      const startIdx = match.index! + match[0].length;
      let endIdx = -1;
      for (let i = startIdx; i < jsonString.length; i++) {
        if (jsonString[i] === '"') {
          let j = i + 1;
          let isEnd = false;
          while (j < jsonString.length) {
            const c = jsonString[j];
            if (/\s/.test(c)) {
              j++;
              continue;
            }
            if (c === ',' || c === '}' || c === ']') {
              isEnd = true;
              break;
            }
            break;
          }
          if (isEnd) {
            let escapeCount = 0;
            let k = i - 1;
            while (k >= startIdx && jsonString[k] === '\\') {
              escapeCount++;
              k--;
            }
            if (escapeCount % 2 === 0) {
              endIdx = i;
              break;
            }
          }
        }
      }
      if (endIdx === -1) return '';
      return jsonString.substring(startIdx, endIdx)
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\\\/g, '\\');
    };

    const seoTitle = extractString('seoTitle');
    const metaDescription = extractString('metaDescription');
    const slug = extractString('slug');
    const focusKeyword = extractString('focusKeyword');
    const pinterestTitle = extractString('pinterestTitle');
    const pinterestDescription = extractString('pinterestDescription');
    const featuredImageId = extractString('featuredImageId');
    const formattedArticleContent = extractString('formattedArticleContent');

    let relatedKeywords: string[] = [];
    const keywordsMatch = jsonString.match(/"relatedKeywords"\s*:\s*\[([\s\S]*?)\]/);
    if (keywordsMatch) {
      relatedKeywords = keywordsMatch[1]
        .split(',')
        .map(kw => kw.trim().replace(/^"|"$/g, '').replace(/\\"/g, '"'));
    }

    const imageMatches: any[] = [];
    const arrayMatch = jsonString.match(/"imageMatches"\s*:\s*\[([\s\S]*?)\]/);
    if (arrayMatch) {
      const objectsText = arrayMatch[1];
      const objRegex = /\{([\s\S]*?)\}/g;
      let m;
      while ((m = objRegex.exec(objectsText)) !== null) {
        const objText = m[1];
        const extractObjString = (f: string): string => {
          const fm = objText.match(new RegExp(`"${f}"\\s*:\\s*"(.*?)"`));
          return fm ? fm[1].replace(/\\"/g, '"') : '';
        };
        const extractObjNum = (f: string): number => {
          const fm = objText.match(new RegExp(`"${f}"\\s*:\\s*(\\d+)`));
          return fm ? parseInt(fm[1], 10) : 0;
        };
        const extractObjBool = (f: string): boolean => {
          const fm = objText.match(new RegExp(`"${f}"\\s*:\\s*(true|false)`));
          return fm ? fm[1] === 'true' : true;
        };
        
        imageMatches.push({
          id: extractObjString('id'),
          originalName: extractObjString('originalName'),
          seoFilename: extractObjString('seoFilename'),
          altText: extractObjString('altText'),
          caption: extractObjString('caption'),
          placementParagraphIndex: extractObjNum('placementParagraphIndex'),
          placementHeading: extractObjString('placementHeading'),
          notes: extractObjString('notes'),
          useImage: extractObjBool('useImage'),
          reasonNotUsed: extractObjString('reasonNotUsed')
        });
      }
    }

    return {
      seoTitle,
      metaDescription,
      slug,
      focusKeyword,
      relatedKeywords,
      pinterestTitle,
      pinterestDescription,
      featuredImageId,
      formattedArticleContent,
      imageMatches
    };
  }
}

// Visual analysis using Cloudflare Workers AI Llama 3.2 11B Vision with rotated keys and silent auto-license agreement
async function analyzeImageWithCloudflare(
  img: { id: string; originalName: string; base64: string; ext: string },
  imageIndex: number,
  mainKeyword?: string
): Promise<{ id: string; originalName: string; seoFilename: string; altText: string; caption: string }> {
  let base64Data = img.base64;
  if (base64Data.includes(';base64,')) {
    base64Data = base64Data.split(';base64,')[1];
  }

  // Collect all Cloudflare credentials from environment with index tracking
  const creds: { key: string; acc: string; index: number }[] = [];
  for (let i = 1; i <= 150; i++) {
    const key = process.env[`CLOUDFLARE_API_KEY_${i}`];
    const acc = process.env[`CLOUDFLARE_ACCOUNT_ID_${i}`];
    if (key && acc) {
      creds.push({ key: key.trim(), acc: acc.trim(), index: i });
    }
  }

  if (creds.length === 0) {
    throw new Error("No Cloudflare credentials found in environment variables");
  }

  // Shuffle credentials to distribute load / quota
  const startIdx = Math.floor(Math.random() * creds.length);
  const ordered = [...creds.slice(startIdx), ...creds.slice(0, startIdx)];

  const mimeType = img.ext === 'png' ? 'image/png' : img.ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  const kw = mainKeyword || "Hair Style";
  const prompt = `Analyze this hairstyle image for image SEO. Focus on hair texture, color placement, highlights, lowlights, cut, or style.

Focus keyword: "${kw}"

Your job is to generate exactly:
One short SEO filename.
One search-optimized SEO alt text.

IMPORTANT IMAGE ANALYSIS RULES:

Focus only on the hair.
Analyze hair length, texture, color, highlights, lowlights, foiling placement, toner, gloss, regrowth line, gray blending, curls, layers, braids, or styling technique.
Ignore face, smile, eyes, pose, clothing, accessories, room, furniture, wall, background, lighting objects, and camera setting.
Do not describe the person as a woman, girl, model, client, or subject.
Do not mention clothing colors, bedroom, bed, chair, mirror, shirt, sweater, earrings, smile, face, or eyes.

FILENAME RULES:

3-5 words only.
lowercase.
hyphen-separated.
must end in .jpg.
must describe the hairstyle/color/technique.
avoid generic names like hair-style, long-hair-style, short-hair-style, hairstyle-woman.
do not use stop words like image, woman, photo, the, has, of, with.
naturally include a keyword related to "${kw}" only if it fits the visible hair.

ALT TEXT RULES:

80-140 characters ideal.
Must describe the visible hair and its SEO context.
Must focus on hair texture, color placement, highlighting, foiling, regrowth, toner, gloss, cut, or styling.
Naturally integrate "${kw}" or a closely related phrase only if it fits the image.
Do not keyword stuff.
Do not mention clothing, face, smile, eyes, room, background, or pose.
Must be unique, professional, and useful for Google Images.

BAD ALT TEXT EXAMPLES:

A woman with long hair wearing a blue shirt.
A smiling woman with braided hair.
A woman sitting on a bed with short hair.
Hair style woman.

GOOD ALT TEXT EXAMPLES:

Fine color-treated hair with soft face-framing placement for a lighter regrowth line.
Curly hair showing dimensional color placement for texture and movement.
Short black hair with clean tone balance for natural-light color checking.
Braided highlighted hair showing warm brunette dimension and blended color placement.

You MUST respond exactly in this format:

Filename: [seo-filename].jpg
Alt Text: [SEO alt text]`;

  for (const cred of ordered) {
    try {
      console.log(`[Cloudflare Vision] Analyzing "${img.originalName}" trying Key #${cred.index} from pool...`);
      const url = `https://api.cloudflare.com/client/v4/accounts/${cred.acc}/ai/run/@cf/google/gemma-4-26b-a4b-it`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cred.key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: dataUrl } }
              ]
            }
          ],
          max_tokens: 1024
        }),
        signal: AbortSignal.timeout(90000)
      });

      if (res.status === 200) {
        const data = await res.json();
        const choices = data.result?.choices || data.choices;
        const desc = (choices?.[0]?.message?.content || choices?.[0]?.message?.reasoning || choices?.[0]?.text || '').trim();
        if (desc) {
          
          // Parse "Filename: ..." and "Alt Text: ..."
          const filenameMatch = desc.match(/Filename:\s*([^\r\n]+)/i);
          const altMatch = desc.match(/Alt\s*Text:\s*([^\r\n]+)/i);
          
          let seoFilename = '';
          let altText = '';
          
          if (filenameMatch) {
            seoFilename = filenameMatch[1].trim().replace(/['"`]/g, '');
          }
          if (altMatch) {
            altText = altMatch[1].trim().replace(/['"`]/g, '');
          }
          
          // Fallback if parsing failed
          if (!seoFilename || !altText) {
            const cleanDesc = desc.replace(/Filename:|Alt\s*Text:/gi, '').trim();
            altText = cleanDesc || kw;
            let slug = altText
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/(^-|-$)/g, '');
            if (slug.length > 50) {
              slug = slug.split('-').slice(0, 7).join('-');
            }
            const ext = path.extname(img.originalName).toLowerCase() || '.jpg';
            seoFilename = `${slug}${ext}`;
          }
          
          console.log(`[Cloudflare Vision] Success on Key #${cred.index} for "${img.originalName}":`, { seoFilename, altText });
          return {
            id: img.id,
            originalName: img.originalName,
            seoFilename,
            altText,
            caption: altText
          };
        } else {
          const errMsg = data.errors?.[0]?.message || 'Unknown API error';
          console.warn(`[Cloudflare Vision Warning] Key #${cred.index} returned error: ${errMsg}. Rotating to next key...`);
        }
      } else {
        const errText = await res.text();
        console.warn(`[Cloudflare Vision Warning] Key #${cred.index} failed with HTTP status ${res.status}: ${errText.substring(0, 100)}. Rotating...`);
      }
    } catch (e: any) {
      console.warn(`[Cloudflare Vision Warning] Key #${cred.index} exception: ${e.message}. Rotating...`);
    }
  }

  throw new Error("All Cloudflare credentials failed or returned errors");
}

// Copywriting using Cloudflare Workers AI GLM 5.2 model with rotated keys
async function copywriteWithCloudflare(
  systemPrompt: string,
  userContent: string
): Promise<string> {
  const creds: { key: string; acc: string; index: number }[] = [];
  for (let i = 1; i <= 150; i++) {
    const key = process.env[`CLOUDFLARE_API_KEY_${i}`];
    const acc = process.env[`CLOUDFLARE_ACCOUNT_ID_${i}`];
    if (key && acc) {
      creds.push({ key: key.trim(), acc: acc.trim(), index: i });
    }
  }

  if (creds.length === 0) {
    throw new Error("No Cloudflare credentials found in environment variables");
  }

  // Shuffle and pick a batch of 5 keys to try in parallel
  const shuffled = [...creds].sort(() => Math.random() - 0.5);
  const batchSize = Math.min(5, shuffled.length);
  const batch = shuffled.slice(0, batchSize);

  console.log(`[Cloudflare Copywrite] Running parallel race on Keys: ${batch.map(c => `#${c.index}`).join(', ')}...`);

  return new Promise<string>((resolve, reject) => {
    let resolved = false;
    let completedCount = 0;
    const errors: Error[] = [];
    const controllers = batch.map(() => new AbortController());

    batch.forEach((cred, idx) => {
      const controller = controllers[idx];
      const url = `https://api.cloudflare.com/client/v4/accounts/${cred.acc}/ai/run/@cf/zai-org/glm-5.2`;
      
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 25000); // 25s timeout per request

      fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cred.key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: `${systemPrompt}\n\nUser Input:\n${userContent}`,
          max_tokens: 4096
        }),
        signal: controller.signal
      })
      .then(async res => {
        clearTimeout(timeoutId);
        if (resolved) return;

        if (res.status === 200) {
          const data = await res.json();
          if (data.success && data.result && data.result.choices?.[0]?.text) {
            const text = data.result.choices[0].text.trim();
            if (text && !resolved) {
              resolved = true;
              console.log(`[Cloudflare Copywrite] Key #${cred.index} WON the race!`);
              // Abort all other pending requests
              controllers.forEach((c, cIdx) => {
                if (cIdx !== idx) {
                  try {
                    c.abort();
                  } catch (e) {}
                }
              });
              resolve(text);
              return;
            }
          }
        }
        throw new Error(`Status ${res.status}`);
      })
      .catch(err => {
        clearTimeout(timeoutId);
        if (resolved) return;
        errors.push(new Error(`Key #${cred.index}: ${err.message}`));
        completedCount++;
        console.warn(`[Cloudflare Copywrite Warning] Key #${cred.index} failed/aborted: ${err.message}`);
        if (completedCount === batch.length && !resolved) {
          reject(new Error("All keys in batch failed: " + errors.map(e => e.message).join(' | ')));
        }
      });
    });
  });
}

// Visual analysis helper prioritizing OpenCode mimo-v2.5-free vision model with Gemini fallback
async function analyzeImageWithGemini(
  img: { id: string; originalName: string; base64: string; ext: string },
  imageIndex: number,
  customGeminiKey: string | null,
  envGeminiKey: string | null,
  customApiKey: string | null,
  geminiState: { failedGlobally: boolean },
  mainKeyword?: string,
  visionProvider: string = 'cloudflare'
): Promise<{ id: string; originalName: string; seoFilename: string; altText: string; caption: string; usedGeminiFallback?: boolean }> {
  let base64Data = img.base64;
  if (base64Data.includes(';base64,')) {
    base64Data = base64Data.split(';base64,')[1];
  }
  
  const mimeType = img.ext === 'png' ? 'image/png' : img.ext === 'webp' ? 'image/webp' : 'image/jpeg';
  let parsed: any = null;

  // 1. Try primary selected vision provider
  if (visionProvider === 'cloudflare') {
    try {
      console.log(`Analyzing image "${img.originalName}" with Cloudflare Racing (Llava)...`);
      const res = await analyzeImageWithCloudflare(img, imageIndex, mainKeyword);
      return res;
    } catch (cfErr: any) {
      console.warn(`Cloudflare analysis failed: ${cfErr.message}. Falling back to OpenCode.`);
    }
  }

  // 2. Try OpenCode mimo-v2.5-free visual analysis first (with 1 retry on failure/timeout)
  console.log(`Analyzing image "${img.originalName}" with OpenCode mimo-v2.5-free vision...`);
  const maxOpenCodeAttempts = 2;
  for (let attempt = 1; attempt <= maxOpenCodeAttempts; attempt++) {
    try {
      const openCodeKey = customApiKey || getApiKey();
      if (!openCodeKey) break;

      console.log(`OpenCode vision attempt ${attempt}/${maxOpenCodeAttempts} for "${img.originalName}"...`);
      const openCodeRes = await fetch('https://opencode.ai/zen/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openCodeKey}`
        },
        body: JSON.stringify({
          model: 'mimo-v2.5-free',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Analyze this hairstyle image for image SEO. Focus keyword: "' + (mainKeyword || 'hair style') + '". Your job is to generate one short SEO filename and one search-optimized SEO alt text. IMPORTANT IMAGE ANALYSIS RULES: Focus only on the hair. Analyze hair length, texture, color, highlights, lowlights, foiling placement, toner, gloss, regrowth line, gray blending, curls, layers, braids, or styling technique. Ignore face, smile, eyes, pose, clothing, accessories, room, furniture, wall, background, lighting objects, and camera setting. Do not describe the person as a woman, girl, model, client, or subject. Do not mention clothing colors, bedroom, bed, chair, mirror, shirt, sweater, earrings, smile, face, or eyes. FILENAME RULES: 3-5 words only, lowercase, hyphen-separated, must end in original extension, must describe the hairstyle/color/technique. Avoid generic names like hair-style, long-hair-style. Do not use stop words like image, woman, photo, the, has, of, with. Naturally include a keyword related to focus keyword only if it fits the visible hair. ALT TEXT RULES: 80-140 characters ideal. Must describe the visible hair and its SEO context. Focus on hair texture, color placement, highlighting, foiling, regrowth, toner, gloss, cut, or styling. Naturally integrate focus keyword only if it fits. Do not keyword stuff or mention clothing/face/smile/background. You MUST return a valid JSON object ONLY. Use exactly this format: {"seoFilename": "...", "altText": "...", "caption": "..."}' },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${base64Data}`
                  }
                }
              ]
            }
          ],
          response_format: { type: 'json_object' }
        }),
        signal: AbortSignal.timeout(18000) // 18s timeout for vision
      });

      if (openCodeRes.status === 200) {
        const data = await openCodeRes.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) {
          let cleanText = text.trim();
          if (cleanText.startsWith('```')) {
            cleanText = cleanText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
          }
          parsed = JSON.parse(cleanText.trim());
          console.log(`Success analyzing "${img.originalName}" with OpenCode mimo-v2.5-free:`, parsed);
          break;
        }
      } else {
        const errText = await openCodeRes.text();
        console.warn(`OpenCode attempt ${attempt} failed with status ${openCodeRes.status}: ${errText}`);
      }
    } catch (e: any) {
      console.warn(`Exception on OpenCode attempt ${attempt} for "${img.originalName}": ${e.message}`);
    }

    if (parsed) break;

    // Small delay before retry
    if (attempt < maxOpenCodeAttempts) {
      console.log(`Waiting 1s before retrying OpenCode...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  if (parsed) {
    return {
      id: img.id,
      originalName: img.originalName,
      seoFilename: parsed.seoFilename || img.originalName,
      altText: parsed.altText || '',
      caption: parsed.caption || ''
    };
  }

  // 3. Fallback to Cloudflare if not primary and not tried yet
  if (visionProvider !== 'cloudflare') {
    try {
      console.log(`Falling back to Cloudflare Racing for "${img.originalName}"...`);
      const res = await analyzeImageWithCloudflare(img, imageIndex, mainKeyword);
      return res;
    } catch (cfErr: any) {
      console.warn(`Fallback Cloudflare analysis failed: ${cfErr.message}`);
    }
  }

  // 4. Text-only fallback if OpenCode vision fails — use mainKeyword for meaningful alt text
  console.warn(`All vision API options failed for "${img.originalName}". Using keyword-based fallback.`);
  const keywordSlug = (mainKeyword || 'hair style').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const ext2 = path.extname(img.originalName).toLowerCase() || '.jpg';
  return {
    id: img.id,
    originalName: img.originalName,
    seoFilename: `${keywordSlug}-example-${imageIndex + 1}${ext2}`,
    altText: `${mainKeyword || 'Hair style'} - example ${imageIndex + 1}`,
    caption: ''
  };
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();
  
  const customStream = new ReadableStream({
    async start(controller) {
      const sendProgress = (progress: number, message: string) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'progress', progress, message }) + '\n'));
        } catch (e) {}
      };

      // Heartbeat to prevent Netlify CDN/gateway idle timeout (10s limit)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(' \n'));
        } catch (e) {
          clearInterval(heartbeat);
        }
      }, 1500);

      try {

        const {
          projectId,
          articleContent,
          mainKeyword,
          relatedKeywords,
          images,
          customApiKey,
          customGeminiKey,
          model: selectedModel,
          wpUrl,
          customSeoTitle,
          customMetaDescription,
          customSlug,
          visionProvider = 'cloudflare'
        } = await request.json();
        const envGeminiKey = process.env.GEMINI_API_KEY || null;

        if (!articleContent) {
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', error: 'Article content is required' }) + '\n'));
          controller.close();
          return;
        }

        console.log(`Starting streaming hybrid analysis for project ${projectId}...`);
        sendProgress(5, "Preparing article content...");

        // 1. Prepare images & convert to Base64
        sendProgress(10, "Processing upload image files...");
        const imagesWithBase64 = [];
        const uploadDir = path.join(process.cwd(), 'public');

        for (const img of (images || [])) {
          try {
            let base64Data = '';
            let ext = 'jpg';

            // Check if it's a Firestore image URL (contains ?id=)
            if (img.localPath.includes('?id=')) {
              const urlObj = new URL(img.localPath, 'http://localhost');
              const imageId = urlObj.searchParams.get('id');
              if (imageId) {
                const imgAsset = await db.getImage(imageId);
                if (imgAsset) {
                  base64Data = imgAsset.base64Data;
                  ext = path.extname(imageId).replace('.', '').toLowerCase();
                  console.log(`[Analyze] Loaded image "${img.originalName}" (${imageId}) from Firestore.`);
                }
              }
            }

            // Check local uploads cache first to save network fetch requests completely
            if (!base64Data) {
              const cachedPath = path.join(uploadDir, 'uploads', img.originalName);
              if (fs.existsSync(cachedPath)) {
                const fileBuffer = fs.readFileSync(cachedPath);
                base64Data = fileBuffer.toString('base64');
                ext = path.extname(cachedPath).replace('.', '').toLowerCase();
                console.log(`[Analyze] Loaded image "${img.originalName}" from local cache.`);
              }
            }

            // Check if it's a remote URL (WordPress media URL)
            if (!base64Data && (img.localPath.startsWith('http://') || img.localPath.startsWith('https://'))) {
              try {
                console.log(`[Analyze] Fetching remote image from: ${img.localPath}`);
                const imgRes = await fetch(img.localPath, { signal: AbortSignal.timeout(12000) });
                if (imgRes.ok) {
                  const imgArrayBuffer = await imgRes.arrayBuffer();
                  base64Data = Buffer.from(imgArrayBuffer).toString('base64');
                  const pathname = new URL(img.localPath).pathname;
                  ext = path.extname(pathname).replace('.', '').toLowerCase() || 'jpg';
                  console.log(`[Analyze] Loaded remote image "${img.originalName}" successfully.`);
                } else {
                  console.warn(`Failed to fetch remote image at ${img.localPath}: ${imgRes.statusText}`);
                }
              } catch (fetchErr: any) {
                console.warn(`Exception fetching remote image at ${img.localPath}: ${fetchErr.message}`);
              }
            }

            // Fallback to local file if not loaded from Firestore/Remote
            if (!base64Data) {
              const fullPath = path.join(uploadDir, img.localPath.replace(/^\//, ''));
              if (fs.existsSync(fullPath)) {
                const fileBuffer = fs.readFileSync(fullPath);
                base64Data = fileBuffer.toString('base64');
                ext = path.extname(img.localPath).replace('.', '').toLowerCase();
                console.log(`[Analyze] Loaded image "${img.originalName}" from local filesystem.`);
              } else {
                console.warn(`File not found at path: ${fullPath}`);
              }
            }

            if (base64Data) {
              imagesWithBase64.push({
                id: img.id,
                originalName: img.originalName,
                base64: base64Data,
                ext
              });
            }
          } catch (err) {
            console.error(`Error processing image ${img.originalName}:`, err);
          }
        }

        // 2. Perform parallel vision analysis using Promise.all for maximum speed
        sendProgress(15, `Starting parallel visual analysis of ${imagesWithBase64.length} images...`);
        const geminiState = { failedGlobally: false };
        
        const visionPromises = imagesWithBase64.map((img, i) => {
          return analyzeImageWithGemini(
            img, 
            i, 
            customGeminiKey || null, 
            envGeminiKey, 
            customApiKey || null, 
            geminiState,
            mainKeyword,
            visionProvider
          ).catch((e: any) => {
            console.error(`Failed to analyze image "${img.originalName}":`, e.message || e);
            const kwSlug = (mainKeyword || 'hair style').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const imgExt = path.extname(img.originalName).toLowerCase() || '.jpg';
            return {
              id: img.id,
              originalName: img.originalName,
              seoFilename: `${kwSlug}-example-${i + 1}${imgExt}`,
              altText: `${mainKeyword || 'Hair style'} - example ${i + 1}`,
              caption: ''
            };
          });
        });

        const visionResults = await Promise.all(visionPromises);
        sendProgress(60, `Completed visual analysis of all ${imagesWithBase64.length} images.`);

        // Compile image visual insights into text context
        const preAnalyzedImagesText = visionResults.map(res => 
          `Image ID: "${res.id}"
- Original Filename: "${res.originalName}"
- Suggested SEO Filename: "${res.seoFilename}"
- Visual Description/Alt Text: "${res.altText}"
- Caption: "${res.caption}"`
        ).join('\n\n');

        // 3. Fetch existing posts from WordPress for internal linking context
        sendProgress(62, "Fetching existing site posts for internal link mapping...");
        let existingPostsText = '';
        let wpPostsList: any[] = [];
        if (wpUrl) {
          try {
            const cleanWpUrl = wpUrl.replace(/\/$/, "");
            console.log(`[Interlink] Fetching latest posts from ${cleanWpUrl} for interlinking...`);
            const wpRes = await fetch(`${cleanWpUrl}/wp-json/wp/v2/posts?per_page=50&_fields=title,link`, {
              signal: AbortSignal.timeout(4000)
            });
            if (wpRes.ok) {
              const wpPosts = await wpRes.json();
              if (Array.isArray(wpPosts) && wpPosts.length > 0) {
                wpPostsList = wpPosts;
                existingPostsText = wpPosts.map(p => `- Link Target URL: "${p.link}" | Topic/Title: "${p.title?.rendered || ''}"`).join('\n');
                console.log(`[Interlink] Found ${wpPosts.length} posts for interlinking context.`);
              }
            }
          } catch (wpErr: any) {
            console.warn(`[Interlink Warning] Failed to fetch WordPress posts for interlinking: ${wpErr.message}`);
          }
        }

        // 4. Prepare system prompt and payload for the text-only optimization (OpenCode Zen)
        sendProgress(65, "Connecting to OpenCode Zen API client...");
        const client = getOpenCodeClient(customApiKey);
        
                const systemPrompt = `You are an expert SEO copywriter and WordPress post builder.
Your task is to review the pre-analyzed images, lightly optimize SEO metadata, and format the provided article text using markdown only — without changing any content.

Core Objective:
- Do NOT rewrite or improve the article.
- Do NOT change meaning, wording, or structure.
- ONLY enhance SEO metadata and add formatting (bold, italic, headings, internal links).

SEO Title Rules:
- The generated "seoTitle" MUST include the provided mainKeyword naturally.
- Must be under 60 characters.
- Must be highly relevant and optimized for click-through rate.
- Do NOT use clickbait or misleading phrasing.

Post Formatting Rules (STRICT):

Zero Modification Rule (CRITICAL):
- You MUST NOT rewrite, rephrase, reorder, merge, split, or delete any text.
- You MUST NOT fix grammar, spelling, or punctuation.
- You MUST NOT add new words.
- Every character must remain 100% identical.
- You are ONLY allowed to wrap existing text in markdown.
- If unsure whether something counts as a modification, DO NOT change it.

Allowed Formatting Actions ONLY:
1. Heading wraps (## / ###) for lines that clearly act as headings.
2. Bold and Italic:
   - Bold (**...**) 5–8 important keywords or entities (max 4 words each).
   - Italic (*...*) 3–5 styling or descriptive terms (max 3 words each).
   - Do NOT bold or italicize full sentences or paragraphs.
3. Internal Links:
   - Wrap existing words only: [text](URL)
   - Use ONLY URLs from the "Existing Site Posts" list.
   - NEVER invent or modify URLs.
   - Add 2–4 links total.
   - Use 1–3 word phrases only.
   - Do NOT repeat the same URL more than once.

Paragraph Output Rules:
- Return ONLY modified paragraphs in "formattedParagraphs".
- Each must include:
  - "index" (0-based)
  - "text" (with ONLY markdown added)
- Do NOT include unchanged paragraphs.
- Do NOT merge or split paragraphs.
- Preserve exact structure.

SEO Metadata Rules:
- "seoTitle": MUST include focus keyword naturally, highly relevant, optimized for CTR, under 60 characters.
- "metaDescription": 120-155 characters ideal, must be highly compelling, start with or contain the focusKeyword, and act as a click-worthy call-to-action.
- "slug": lowercase, hyphen-separated, includes focus keyword.
- "focusKeyword": use provided keyword (do not change intent).
- "relatedKeywords": 3–5 closely related variations.
- "pinterestTitle": engaging, keyword-focused.
- "pinterestDescription": natural, slightly emotional, SEO-friendly.

Image Matching and SEO Rules:

Use the provided pre-analyzed image data, article headings, paragraph content, and focusKeyword.

GLOBAL RULES:
* Use a maximum of 4 article images.
* Only place an image when it clearly supports the surrounding section.
* Do not guess, force, or place irrelevant images.
* If an image does not match any section, set "useImage": false.
* The final filename and alt text must be optimized using both the image analysis and the matched article section.
* The copywriting model is the final authority for SEO filename, alt text, caption, and placement.

EACH MATCHED IMAGE MUST INCLUDE:
* "id": Unique image ID.
* "originalName": Original filename.
* "seoFilename": A highly optimized SEO filename, 3-5 words, lowercase, hyphen-separated, ending in .jpg.
* "altText": A search-optimized alt tag, ideally 80-140 characters.
* "caption": A concise caption under 60 characters.
* "placementParagraphIndex": Accurate 0-based index of the paragraph it should follow.
* "placementHeading": Exact matching heading text from the article.
* "useImage": true or false.

SEO FILENAME RULES:
* Must describe the hair style, hair color, color placement, foiling technique, toner, gloss, regrowth line, gray blending, curls, braids, or cut.
* Must integrate the focusKeyword or a closely related section keyword when natural.
* Do not use generic filenames like hair-style-woman.jpg, long-hair-style.jpg, short-hair-style.jpg, hairstyle-photo.jpg.
* Do not use words like woman, image, photo, the, has, of, with.
* Keep filename specific to the matched section topic.

ALT TEXT RULES:
* Must focus entirely on the hair.
* Must connect the image to the matched article section.
* Must describe hair texture, hair color, foiling placement, color dimension, regrowth, tone, gloss, gray blending, cut, or styling technique.
* Must not describe face, smile, eyes, clothing, accessories, room, bed, background, pose, or camera.
* Must not repeat the same structure for every image.
* Must be unique, natural, professional, and search-friendly.
* Do not keyword stuff.

CAPTION RULES:
* Under 60 characters.
* Must support the section topic.
* Must not be generic.
* Good examples:
  - Soft regrowth blending
  - Curly color placement
  - Glossy tone refresh
  - Warm brunette dimension
  - Natural-light tone check

PLACEMENT RULES:
* Place images after paragraphs where the image directly supports the topic.
* Match foiling images near foiling sections.
* Match curly/textured hair images near texture or curl placement sections.
* Match toner/gloss images near toner, gloss, or color refresh sections.
* Match gray blending images near gray blending or demi-permanent color sections.
* Match brunette/copper/warm tone images near color theory or warmth sections.
* Do not place an image just because the article needs an image.

GOOD ALT TEXT STYLE EXAMPLES:
* Fine color-treated hair with soft face-framing placement for a lighter regrowth line.
* Curly hair showing dimensional color placement for texture and movement.
* Short black hair example for natural-light tone checking and clean color finish.
* Braided highlighted hair showing warm brunette dimension and blended color placement.
* Short layered hair with soft gray-blending and gloss refresh inspiration.

JSON Formatting Rules (CRITICAL):
- Output MUST be valid JSON only.
- Do NOT include explanations or extra text.
- Do NOT wrap output in markdown.
- NEVER use raw double quotes (") inside JSON values.
- Use single quotes (') inside values if needed.

Output Schema:
{
  "seoTitle": "A main SEO Title (under 60 characters)",
  "metaDescription": "A compelling meta description (under 160 characters)",
  "slug": "url-slug-hyphen-separated",
  "focusKeyword": "Main keyword",
  "relatedKeywords": ["keyword1", "keyword2", "keyword3"],
  "pinterestTitle": "Pinterest Pin Title",
  "pinterestDescription": "Pinterest Pin Description",
  "featuredImageId": "Best image ID",
  "formattedParagraphs": [
    {
      "index": 0,
      "text": "Original paragraph with ONLY markdown added"
    }
  ],
  "imageMatches": [
    {
      "id": "Image ID",
      "originalName": "filename.jpg",
      "seoFilename": "seo-friendly-name.jpg",
      "altText": "Descriptive alt text",
      "caption": "Short caption",
      "placementParagraphIndex": 3,
      "placementHeading": "Exact heading text from article",
      "notes": "Why this image fits here",
      "useImage": true,
      "reasonNotUsed": ""
    }
  ]
}`;

        const paragraphs = articleContent
          .split('\n')
          .map((p: string) => p.trim())
          .filter((p: string) => p.length > 0);

        const paragraphListText = paragraphs
          .map((p: string, idx: number) => `[Paragraph ${idx}]: ${p}`)
          .join('\n\n');

        let userContent = `Here is the article details.
Main Keyword: "${mainKeyword || 'None provided'}"
Related Keywords Input: "${relatedKeywords || 'None provided'}"

Here is the article text, paragraph-by-paragraph:
${paragraphListText}

Below are the uploaded images that have been visually pre-analyzed by Gemini. 
Please review their visual description, suggest their optimal placement in the article text, and return the final JSON payload containing the SEO meta details, formatted article content (wrapped headings and inline bolds/italics/links only), and the images placement mapping.

Pre-Analyzed Images List:
${preAnalyzedImagesText}`;

        if (existingPostsText) {
          userContent += `\n\nExisting Site Posts (Use these for creating internal links naturally, do not change any words):\n${existingPostsText}`;
        }

        // Model selection strategy:
        //   1. If user selected Gemini → try that first (fast, reliable)
        //   2. If user selected OpenCode model → try with 15s timeout
        //   3. Fall back to Gemini (all keys, 30s timeout each)
        //   4. Fall back to OpenCode models (each with 15s timeout)

        let responseData: Record<string, any> | null = null;
        let successModel = '';
        let lastError: any = null;

        // Helper: try a single Gemini key for text
        const tryGeminiKey = async (geminiModel: string, apiKey: string): Promise<any> => {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: systemPrompt + "\n\n" + userContent }] }],
                generationConfig: { 
                  responseMimeType: 'application/json', 
                  temperature: 0.2,
                  maxOutputTokens: 4096
                }
              }),
              signal: AbortSignal.timeout(30000)
            }
          );
          if (geminiRes.status !== 200) {
            const errText = await geminiRes.text();
            throw new Error(`Gemini returned ${geminiRes.status}: ${errText}`);
          }
          const geminiData = await geminiRes.json();
          return geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        };

        // Helper: process raw AI text into responseData
        const processRawText = (rawText: string, modelName: string): any => {
          const parsedData = extractFlexibleJson(rawText);
          
          const stripImagePlaceholders = (text: string): string => {
            const lines = text.split('\n');
            const filtered = lines.filter(line => {
              const cleanLine = line.trim().replace(/^[\*\s_\x22\x27\u201C\u201D\[]+/, '').toLowerCase();
              if (cleanLine.startsWith('image:') || cleanLine.startsWith('image]') || cleanLine.startsWith('[image:')) {
                return false;
              }
              if (cleanLine.startsWith('alt text:') || cleanLine.startsWith('alt tag:') || cleanLine.startsWith('alttag:')) {
                return false;
              }
              if (cleanLine.startsWith('caption:')) {
                return false;
              }
              if (cleanLine.startsWith('filename:') || cleanLine.startsWith('seo filename:')) {
                return false;
              }
              const trimmedRaw = line.trim();
              if (trimmedRaw === '*' || trimmedRaw === '**' || trimmedRaw === '_' || trimmedRaw === '__') {
                return false;
              }
              return true;
            });
            return filtered.join('\n');
          };

          const cleanedContent = stripImagePlaceholders(articleContent);

          const originalParagraphs = cleanedContent
            .split('\n')
            .map((p: string) => p.trim())
            .filter((p: string) => p.length > 0);

          const formattedParagraphs = parsedData.formattedParagraphs || [];
          if (Array.isArray(formattedParagraphs)) {
            for (const item of formattedParagraphs) {
              if (item && typeof item.index === 'number' && item.index >= 0 && item.index < originalParagraphs.length) {
                originalParagraphs[item.index] = item.text;
              }
            }
          }
          parsedData.formattedArticleContent = originalParagraphs.join('\n\n');
          delete parsedData.formattedParagraphs;
          
          // Ensure all uploaded images (visionResults) are included and placed on the post (user requirement)
          const finalImageMatches: any[] = [];
          const occupiedIndices = new Set<number>();

          // Sanitize AI-generated image SEO fields
          const BANNED_FILENAME_RE = /^(hair-style|long-hair-style|short-hair-style|hairstyle-woman|hairstyle-photo|woman-hairstyle|hair-style-woman|medium-hair-style|hairstyle-analysis)/i;
          const BANNED_FN_WORDS = ['woman', 'photo', 'image', 'picture', 'girl', 'model'];
          const BANNED_ALT_RE = /\b(woman|girl|man|person|model|client|shirt|sweater|blouse|dress|earrings|necklace|hair tie|sitting|standing|selfie|posing|wearing|room|bed|bedroom|chair|mirror|wall|background|sofa|window|photo|image|picture|face|smile|eyes)\b/gi;

          function sanitizeImageSEO(seoFilename: string, altText: string, fallbackKw: string): { seoFilename: string; altText: string } {
            const fnBase = seoFilename.replace(/\.[^/.]+$/, '').toLowerCase();
            const fnIsGeneric = BANNED_FILENAME_RE.test(fnBase) || BANNED_FN_WORDS.some(w => fnBase.includes(w));
            if (fnIsGeneric) {
              const cleanWords = altText.toLowerCase()
                .replace(/[^a-z0-9\s-]/g, '')
                .split(/\s+/)
                .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'has', 'her', 'his', 'woman', 'girl', 'photo', 'image'].includes(w))
                .slice(0, 5);
              seoFilename = cleanWords.length >= 3 ? cleanWords.join('-') + '.jpg' : `${fallbackKw.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-color-technique.jpg`;
            }
            let clean = altText.replace(BANNED_ALT_RE, '').replace(/\s{2,}/g, ' ').replace(/^[,.\s]+|[,.\s]+$/g, '').replace(/\s*,\s*,/g, ',').trim();
            if (clean.length < 30) {
              clean = `${seoFilename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')} — ${fallbackKw} inspiration`;
            }
            return { seoFilename, altText: clean };
          }

          // First pass: Add all valid AI-recommended placements
          if (parsedData.imageMatches && Array.isArray(parsedData.imageMatches)) {
            parsedData.imageMatches.forEach((match: any) => {
              const vr = visionResults.find(v => v.id === match.id || v.originalName === match.originalName);
              if (vr) {
                const placementIndex = typeof match.placementParagraphIndex === 'number' && match.placementParagraphIndex >= 0
                  ? Math.min(match.placementParagraphIndex, originalParagraphs.length - 1)
                  : null;
                
                if (match.useImage !== false && placementIndex !== null) {
                  const rawFn = match.seoFilename || vr.seoFilename;
                  const rawAlt = match.altText || vr.altText;
                  const sanitized = sanitizeImageSEO(rawFn, rawAlt, mainKeyword || 'hair style');
                  finalImageMatches.push({
                    id: vr.id,
                    originalName: vr.originalName,
                    seoFilename: sanitized.seoFilename,
                    altText: sanitized.altText,
                    caption: match.caption || vr.caption,
                    placementParagraphIndex: placementIndex,
                    useImage: true,
                    notes: match.notes || ''
                  });
                  occupiedIndices.add(placementIndex);
                }
              }
            });
          }

          // Second pass: Identify any visionResults that are missing or were set to useImage = false
          const pendingImages: any[] = [];
          visionResults.forEach(vr => {
            const alreadyPlaced = finalImageMatches.some(m => m.id === vr.id);
            if (!alreadyPlaced) {
              pendingImages.push(vr);
            }
          });

          // Third pass: Distribute pending images evenly across unoccupied paragraph indices
          if (pendingImages.length > 0) {
            const availableIndices: number[] = [];
            for (let i = 0; i < originalParagraphs.length; i++) {
              if (!occupiedIndices.has(i) && !originalParagraphs[i].startsWith('#')) {
                availableIndices.push(i);
              }
            }

            if (availableIndices.length === 0) {
              for (let i = 0; i < originalParagraphs.length; i++) {
                if (!originalParagraphs[i].startsWith('#')) {
                  availableIndices.push(i);
                }
              }
            }
            if (availableIndices.length === 0) {
              availableIndices.push(0);
            }

            pendingImages.forEach((vr, idx) => {
              const spacingIdx = Math.floor((idx * availableIndices.length) / pendingImages.length);
              const placementIndex = availableIndices[spacingIdx] || 0;
              
              const match = parsedData.imageMatches?.find((m: any) => m.id === vr.id || m.originalName === vr.originalName);

              const rawFn = match?.seoFilename || vr.seoFilename;
              const rawAlt = match?.altText || vr.altText || `${mainKeyword || 'Hair style'} - image ${idx + 1}`;
              const sanitized = sanitizeImageSEO(rawFn, rawAlt, mainKeyword || 'hair style');

              finalImageMatches.push({
                id: vr.id,
                originalName: vr.originalName,
                seoFilename: sanitized.seoFilename,
                altText: sanitized.altText,
                caption: match?.caption || vr.caption || '',
                placementParagraphIndex: placementIndex,
                useImage: true,
                notes: match?.notes || 'Placed automatically to distribute all uploaded images.'
              });
            });
          }

          // Prevent multiple images from clumping at the same paragraph index
          finalImageMatches.sort((a, b) => a.placementParagraphIndex - b.placementParagraphIndex);
          const usedIndices = new Set<number>();
          finalImageMatches.forEach((match) => {
            let index = match.placementParagraphIndex;
            while (usedIndices.has(index) || (index < originalParagraphs.length && originalParagraphs[index].startsWith('#'))) {
              index++;
            }
            if (index >= originalParagraphs.length) {
              let found = false;
              for (let k = 0; k < originalParagraphs.length; k++) {
                if (!usedIndices.has(k) && !originalParagraphs[k].startsWith('#')) {
                  index = k;
                  found = true;
                  break;
                }
              }
              if (!found) {
                index = originalParagraphs.length - 1;
              }
            }
            match.placementParagraphIndex = index;
            usedIndices.add(index);
          });

          // Map back to parsedData.imageMatches and parsedData.images with doNotUse forced to false
          parsedData.imageMatches = finalImageMatches;
          parsedData.images = finalImageMatches.map((match: any) => ({
            id: match.id,
            originalName: match.originalName,
            seoFilename: match.seoFilename,
            altText: match.altText,
            caption: match.caption,
            placement: `after paragraph ${match.placementParagraphIndex}`,
            isFeatured: parsedData.featuredImageId === match.id || parsedData.featuredImageId === match.originalName,
            doNotUse: false,
            notes: match.notes
          }));
          
          responseData = parsedData;
          successModel = modelName;
        };

        // Helper: try an OpenCode model with timeout
        const tryOpenCodeModel = async (modelName: string, timeoutMs: number = 15000) => {
          if (responseData) return;
          
          const abortCtrl = new AbortController();
          const timer = setTimeout(() => abortCtrl.abort(), timeoutMs);
          
          try {
            sendProgress(75, `Submitting copywriter request to text model: ${modelName}...`);
            
            const response = await client.chat.completions.create(
              {
                model: modelName,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userContent }
                ],
                response_format: { type: "json_object" },
                temperature: 0.2,
                max_tokens: 4096
              },
              { signal: abortCtrl.signal }
            );

            const rawText = response.choices?.[0]?.message?.content || '';
            if (rawText) {
              console.log(`Success with OpenCode model: ${modelName}`);
              processRawText(rawText, modelName);
            }
          } catch (err: any) {
            const msg = err.name === 'AbortError' ? 'timeout' : err.message;
            console.warn(`OpenCode model ${modelName} failed: ${msg}`);
            lastError = err;
          } finally {
            clearTimeout(timer);
          }
        };

        // ── Execute model chain ──

        // 1. First try the selected OpenCode model (e.g., deepseek-v4-flash-free)
        if (selectedModel && !selectedModel.startsWith('gemini-') && selectedModel !== 'cloudflare-glm') {
          await tryOpenCodeModel(selectedModel, 45000);
        }

        // 2. If it failed or wasn't run, fall back to other free OpenCode models
        if (!responseData) {
          const fallbackModels = [
            'deepseek-v4-flash-free',
            'nemotron-3-ultra-free',
            'north-mini-code-free'
          ];
          for (const model of fallbackModels) {
            if (responseData) break;
            if (model !== selectedModel) {
              await tryOpenCodeModel(model, 45000);
            }
          }
        }



        if (!responseData) {
          console.warn("All text models failed. Generating local default/fallback SEO and formatting data...");
          const cleanKeyword = mainKeyword || 'Hair Trends';
          const title = `${cleanKeyword} - Latest Styles and Hair Color Ideas`;
          const firstParagraph = paragraphs[0] || '';
          const metaDesc = (firstParagraph.substring(0, 150) || `Check out the latest ideas and styles for ${cleanKeyword}.`).trim();
          const slug = cleanKeyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          
          const isHeading = (text: string): boolean => {
            const trimmed = text.trim();
            if (trimmed.length === 0 || trimmed.length > 85) return false;
            if (trimmed.startsWith('#')) return true;
            if (/[.\?!]$/.test(trimmed)) return false;
            if (trimmed.includes('<') && trimmed.includes('>')) return false;
            if (!/^[A-Z0-9\x22\x27\u201C\u201D]/.test(trimmed)) return false;
            const words = trimmed.split(/\s+/);
            if (words.length > 12) return false;
            return true;
          };

          const originalParagraphs = [...paragraphs];
          const formattedParagraphs = [];

          // Pre-identify headings in original copy and wrap with ## markdown tags
          for (let i = 0; i < originalParagraphs.length; i++) {
            const p = originalParagraphs[i];
            if (isHeading(p) && !p.startsWith('#')) {
              originalParagraphs[i] = `## ${p.trim()}`;
              formattedParagraphs.push({
                index: i,
                text: originalParagraphs[i]
              });
            }
          }

          if (paragraphs.length > 0) {
            if (!originalParagraphs[0].startsWith('#')) {
              let text = originalParagraphs[0];
              if (cleanKeyword) {
                const regex = new RegExp(`(${cleanKeyword})`, 'gi');
                text = text.replace(regex, '**$1**');
              }
              const existingIdx = formattedParagraphs.findIndex(item => item.index === 0);
              if (existingIdx !== -1) {
                formattedParagraphs[existingIdx].text = text;
              } else {
                formattedParagraphs.push({
                  index: 0,
                  text: text
                });
              }
              originalParagraphs[0] = text;
            }
          }
          
          // Try to link key phrases and specific terms in fallback paragraphs
          const linkKeywordsIntelligently = (text: string, wpPostsList: any[]): { text: string; modified: boolean } => {
            let modified = false;
            let updatedText = text;
            const stopWords = new Set([
              'actually', 'really', 'about', 'would', 'should', 'could', 'their', 'there', 'where', 'these', 'those', 
              'every', 'other', 'another', 'doing', 'using', 'getting', 'having', 'looking', 'seeing', 'making', 
              'styling', 'latest', 'trends', 'styles', 'ideas', 'stunning', 'gorgeous', 'beautiful', 'perfect',
              'women', 'older', 'styles', 'ideas', 'color', 'shades', 'haircut'
            ]);

            for (const post of wpPostsList || []) {
              const postTitle = typeof post.title === 'object' ? (post.title?.rendered || '') : (post.title || '');
              const postLink = post.link || post.url || '';
              if (!postLink || !postTitle) continue;

              let cleanPhrase = postTitle
                .toLowerCase()
                .replace(/\b(stunning|gorgeous|beautiful|perfect|latest|trends|styles|ideas|for \d+|in \d+|\d+)\b/g, '')
                .replace(/[^a-z0-9\s]+/g, ' ')
                .trim();

              if (cleanPhrase.split(/\s+/).length < 2) continue;

              const escapedPhrase = cleanPhrase.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
              const regex = new RegExp(`\\b(${escapedPhrase})\\b`, 'i');
              
              if (regex.test(updatedText)) {
                if (!/\[[^\]]*\]\([^\)]*\)/.test(updatedText)) {
                  updatedText = updatedText.replace(regex, `[$1](${postLink})`);
                  modified = true;
                  break;
                }
              }
            }

            if (!modified) {
              const specificKeywords = ['balayage', 'shag', 'pixie', 'undercut', 'lowlights', 'babylights', 'highlights', 'foils'];
              for (const post of wpPostsList || []) {
                const postTitle = typeof post.title === 'object' ? (post.title?.rendered || '') : (post.title || '');
                const postLink = post.link || post.url || '';
                if (!postLink || !postTitle) continue;

                for (const kw of specificKeywords) {
                  if (postTitle.toLowerCase().includes(kw) && new RegExp(`\\b(${kw})\\b`, 'i').test(updatedText)) {
                    if (!/\[[^\]]*\]\([^\)]*\)/.test(updatedText)) {
                      updatedText = updatedText.replace(new RegExp(`\\b(${kw})\\b`, 'i'), `[$1](${postLink})`);
                      modified = true;
                      break;
                    }
                  }
                }
                if (modified) break;
              }
            }

            return { text: updatedText, modified };
          };

          for (let i = 1; i < Math.min(originalParagraphs.length, 6); i++) {
            if (originalParagraphs[i].startsWith('#')) continue;
            const res = linkKeywordsIntelligently(originalParagraphs[i], wpPostsList || []);
            if (res.modified) {
              const existingIdx = formattedParagraphs.findIndex(item => item.index === i);
              if (existingIdx !== -1) {
                formattedParagraphs[existingIdx].text = res.text;
              } else {
                formattedParagraphs.push({
                  index: i,
                  text: res.text
                });
              }
              originalParagraphs[i] = res.text;
            }
          }
          
          // Evenly distribute images across paragraphs to ensure good visual spacing
          const fallbackImageMatches = visionResults.map((vr, idx) => {
            const spacingIndex = Math.floor((idx * paragraphs.length) / (visionResults.length + 1));
            return {
              id: vr.id,
              originalName: vr.originalName,
              seoFilename: vr.seoFilename,
              altText: vr.altText,
              caption: vr.caption,
              placementParagraphIndex: spacingIndex,
              placementHeading: '',
              notes: 'Matched during local rule fallback.',
              useImage: true,
              reasonNotUsed: ''
            };
          });

          successModel = 'local-rule-fallback';
          responseData = {
            seoTitle: title.substring(0, 60),
            metaDescription: metaDesc,
            slug: slug,
            focusKeyword: cleanKeyword,
            relatedKeywords: [cleanKeyword.toLowerCase(), 'hair color', 'hair style'],
            pinterestTitle: title,
            pinterestDescription: metaDesc,
            featuredImageId: visionResults[0]?.id || '',
            formattedArticleContent: originalParagraphs.join('\n\n'),
            images: visionResults,
            imageMatches: fallbackImageMatches
          };
        }

        if (responseData) {
          if (customSeoTitle && customSeoTitle.trim().length > 0) {
            responseData.seoTitle = customSeoTitle.trim();
            responseData.pinterestTitle = customSeoTitle.trim();
          }
          if (customMetaDescription && customMetaDescription.trim().length > 0) {
            responseData.metaDescription = customMetaDescription.trim();
            responseData.pinterestDescription = customMetaDescription.trim();
          }
          if (customSlug && customSlug.trim().length > 0) {
            responseData.slug = customSlug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
          }
        }

        sendProgress(100, "Done! Formatting successful.");
        if (!request.signal.aborted) {
          try {
            controller.enqueue(encoder.encode(JSON.stringify({
              type: 'success',
              modelUsed: successModel,
              data: responseData
            }) + '\n'));
          } catch (enqueueErr) {}
        }
        
      } catch (e: any) {
        console.error("Analysis stream error:", e);
        if (!request.signal.aborted) {
          try {
            controller.enqueue(encoder.encode(JSON.stringify({
              type: 'error',
              error: e.message || 'Failed to analyze post'
            }) + '\n'));
          } catch (enqueueErr) {}
        }
      } finally {
        clearInterval(heartbeat);
        if (!request.signal.aborted) {
          try {
            controller.close();
          } catch (closeErr) {}
        }
      }

    }
  });

  return new Response(customStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
