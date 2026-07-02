import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getOpenCodeClient, getApiKey } from '@/lib/opencode-client';
import { db } from '@/lib/db';

export const maxDuration = 300; // Allow execution for up to 5 minutes

function getGeminiKeys(): string[] {
  return [
    "AIzaSyBwo6SECQ45fo2xucNBOMaFMjvZrRAnBYA",
    "AIzaSyBZl6na3i0EpnEqReEja9H8sRQ_7Y9q7S4",
    "AIzaSyAVz3gsnnp5XIAuXf-hWO9S-lcErY4BGOo",
    "AIzaSyBDXb0ORbXbzK4sXroUHrD4Z4IixFCDp0c",
    "AIzaSyDkkuW_5BLjFXnLv4rB_l4wFU8NvBAv99Q",
    "AIzaSyCUznGMx8gPVmn285J-lh2eiuU-jXomDpk",
    "AIzaSyDX0gZFBVRqZh_s5Kdl4SRqutAssGUlws8",
    "AIzaSyCiQ-DLrhWSPrY1mZ0nBaZ0QJbb2E4Unlc",
    "AIzaSyDOE8CTiK25W9LpZdLgb8d2yr94c0-TOM8",
    "AIzaSyD-suIQxkXxQTWr09_8g2KGZzTpuXlxShw",
    "AIzaSyDbOUp_E2IbFP5ciwh46h5k-fiqZ8sQAZA",
    "AIzaSyAZiu5eAQTJaTJ7KB82wKbjQ6ZDACggz_g",
    "AIzaSyBCsDxRtDwfKYdUFAa2gxp60MAZC831Yn0",
    "AIzaSyCvH3K7m4AiavfjQoxekPecY3C-EfCF8TQ",
    "AIzaSyAtb4VetbZI6aGDjjEG92wljfg1s-x8hHA",
    "AIzaSyB9_Wzmj6ehBaFxJxyOWcmxFjhfgDTSu3E",
    "AIzaSyBHi8zm6dpfw7suF02_DwkEaM-fcmPGZr4",
    "AIzaSyD8nPedXWNI8rZWOA292pYRUfO8sl316Pc",
    "AIzaSyA-coE7j3Hy1JOjRheJXXUmL7Y7aSMijmo",
    "AIzaSyB-mzLeNkiFfLrDnzlyoVVffz0DhV9E9gg",
    "AIzaSyAzdmMHxWvENWcMkdnf5aJUw6elktWIah8",
    "AIzaSyAQmgXDsqVx5Emelc3khKUMpc-wHXW8sLg",
    "AIzaSyD1VWlkc2WLMocNBTylYg62vIGQG5iULxY",
    "AIzaSyC9QZlprmjsvqjM3lxCteoCXcjS6EVxNR0",
    "AIzaSyCCdSQDsYERA9IJ2Sno2bEmXMerCS6To1U",
    "AIzaSyB9M2TeNrPlQ4XaXlYftzgSuyFJbLSe8e4",
    "AIzaSyAZsG4hqxSRwbN8aUhzuhkDFpxybwGZlwY",
    "AIzaSyD0UEZgBhn7YTuFbJYAFJquI1aS92jFgTI",
    "AIzaSyDSA_LY8VFW7lwfyygHz_UBl_l0CStuEeE",
    "AIzaSyD0SNf-kWaosjkhj5_tvlk80FkAQi5TXtQ",
    "AIzaSyAN-SxLvrjM0YDOpRWUtUg3ye5_ysBtNyo",
    "AIzaSyAy2LAcOq9KzB5cMVAOy1U6D8g5WjUFxlg",
    "AIzaSyDwNR4Ag3YSkXo4eqN-GOv73U_UXoU3tuU",
    "AIzaSyDc0kcczH0pOY2CL5ClTdT8HDJ2kQPwmf8",
    "AIzaSyB3FF3UbMC9Yo4KqUPVbpExDxkThtT4OQQ",
    "AIzaSyCvLBPhlkaDWrV_qgeqly67uQB9aML7zDE",
    "AIzaSyB2o5_tHUHxRRCUHRQIAosABrL4IWDLvM4",
    "AIzaSyDbE99mwONfBZpDRkiCdiMHFBmYHMw7NJI",
    "AIzaSyAae0UuPKwqusp2DCNz5jE091ynmZ7mnvw",
    "AIzaSyBNSlM_b4dAjgGuhiTaGG5-rdse1TspVwg",
    "AIzaSyBVPMnF5yqmS21Wa1UyLGMUrANuL3yn1zU",
    "AIzaSyA-5mJlsHWrIjQKz52xulpXKXrYM1e3s5M",
    "AIzaSyBcFugyTMZlECy2ZOYXY-KWsxc-pz8Evvk",
    "AIzaSyCXdFnslbMrPuAOIVQjS0mQCpet6aE4vwA",
    "AIzaSyDWjb8mJwGzC1TrkTO7iUPnKdLKVU9gxko",
    "AIzaSyD1L9-OFCyM7VMD7Sd-3GCYisuw8WFPSlk",
    "AIzaSyDUOX-f3mTcdPLRmhd0tN8ZJ9c1IV0jLuo",
    "AIzaSyBMAquxf2-L3ySWlKqpdDictL5OOD3xK9o",
    "AIzaSyA-msEkECggcnYf64hBh8teqiGpzP9k57I"
  ];
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
  try {
    const cleaned = cleanJsonString(rawText);
    return JSON.parse(cleaned);
  } catch (parseErr: any) {
    console.warn("Standard JSON.parse failed. Attempting regex-based field extraction...", parseErr.message);
    
    // Helper to extract a string field
    const extractString = (field: string): string => {
      const match = rawText.match(new RegExp(`"${field}"\\s*:\\s*"`));
      if (!match) return '';
      const startIdx = match.index! + match[0].length;
      let endIdx = -1;
      for (let i = startIdx; i < rawText.length; i++) {
        if (rawText[i] === '"') {
          let j = i + 1;
          let isEnd = false;
          while (j < rawText.length) {
            const c = rawText[j];
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
            while (k >= startIdx && rawText[k] === '\\') {
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
      return rawText.substring(startIdx, endIdx)
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
    const keywordsMatch = rawText.match(/"relatedKeywords"\s*:\s*\[([\s\S]*?)\]/);
    if (keywordsMatch) {
      relatedKeywords = keywordsMatch[1]
        .split(',')
        .map(kw => kw.trim().replace(/^"|"$/g, '').replace(/\\"/g, '"'));
    }

    const imageMatches: any[] = [];
    const arrayMatch = rawText.match(/"imageMatches"\s*:\s*\[([\s\S]*?)\]/);
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

// Visual analysis using Cloudflare Workers AI GLM 5.2 & Llava 1.5 with rotated keys
async function analyzeImageWithCloudflare(
  img: { id: string; originalName: string; base64: string; ext: string },
  imageIndex: number,
  mainKeyword?: string
): Promise<{ id: string; originalName: string; seoFilename: string; altText: string; caption: string }> {
  let base64Data = img.base64;
  if (base64Data.includes(';base64,')) {
    base64Data = base64Data.split(';base64,')[1];
  }

  // Collect all Cloudflare credentials from environment
  const creds: { key: string; acc: string }[] = [];
  for (let i = 1; i <= 150; i++) {
    const key = process.env[`CLOUDFLARE_API_KEY_${i}`];
    const acc = process.env[`CLOUDFLARE_ACCOUNT_ID_${i}`];
    if (key && acc) {
      creds.push({ key: key.trim(), acc: acc.trim() });
    }
  }

  if (creds.length === 0) {
    throw new Error("No Cloudflare credentials found in environment variables");
  }

  // Shuffle credentials to distribute load / quota
  const startIdx = Math.floor(Math.random() * creds.length);
  const ordered = [...creds.slice(startIdx), ...creds.slice(0, startIdx)];

  const buffer = Buffer.from(base64Data, 'base64');
  const imageArray = Array.from(buffer);

  for (const cred of ordered) {
    // 1. Try GLM-5.2 model first as requested
    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${cred.acc}/ai/run/@cf/zai-org/glm-5.2`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cred.key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image: imageArray,
          prompt: 'Describe the hair color, haircut, or style in this image briefly in English.'
        }),
        signal: AbortSignal.timeout(18000)
      });

      if (res.status === 200) {
        const data = await res.json();
        if (data.success && data.result && data.result.choices?.[0]?.text) {
          const desc = data.result.choices[0].text.trim();
          if (desc) {
            let slug = desc
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/(^-|-$)/g, '');
            
            if (slug.length > 50) {
              slug = slug.split('-').slice(0, 7).join('-');
            }
            const ext = path.extname(img.originalName).toLowerCase() || '.jpg';
            console.log(`Success analyzing "${img.originalName}" with Cloudflare GLM 5.2:`, desc);
            return {
              id: img.id,
              originalName: img.originalName,
              seoFilename: `${slug}${ext}`,
              altText: desc,
              caption: desc
            };
          }
        }
      }
    } catch (e: any) {
      console.warn(`Cloudflare GLM 5.2 key failed: ${e.message}`);
    }

    // 2. Fallback to Llava 1.5 if GLM-5.2 failed on this credential
    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${cred.acc}/ai/run/@cf/llava-hf/llava-1.5-7b-hf`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cred.key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image: imageArray,
          prompt: 'Describe the hair color, haircut, or style in this image briefly in English.'
        }),
        signal: AbortSignal.timeout(18000)
      });

      if (res.status === 200) {
        const data = await res.json();
        if (data.success && data.result && data.result.description) {
          const desc = data.result.description.trim();
          let slug = desc
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
          
          if (slug.length > 50) {
            slug = slug.split('-').slice(0, 7).join('-');
          }
          const ext = path.extname(img.originalName).toLowerCase() || '.jpg';
          console.log(`Success analyzing "${img.originalName}" with Cloudflare Llava 1.5 fallback:`, desc);
          return {
            id: img.id,
            originalName: img.originalName,
            seoFilename: `${slug}${ext}`,
            altText: desc,
            caption: desc
          };
        }
      }
    } catch (e: any) {
      console.warn(`Cloudflare Llava 1.5 fallback failed: ${e.message}`);
    }
  }

  throw new Error("All Cloudflare credentials failed or returned errors");
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
                { type: 'text', text: 'Analyze this post image. Suggest a short SEO-friendly filename in English (lowercase, hyphen-separated, ending in original extension) and a descriptive SEO alt tag in English describing the hair color, haircut, or style. You MUST return a valid JSON object ONLY. Use exactly this format: {"seoFilename": "...", "altText": "...", "caption": "..."}' },
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
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'progress', progress, message }) + '\n'));
      };

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

        // 2. Perform sequential vision analysis with a 500ms delay for OpenCode by default, or 4.5s delay if fell back to Gemini
        sendProgress(15, `Starting visual analysis of ${imagesWithBase64.length} images...`);
        let completedCount = 0;
        const visionResults: any[] = [];
        const geminiState = { failedGlobally: false };
        let useGeminiDelay = false;
        
        for (const img of imagesWithBase64) {
          try {
            const res = await analyzeImageWithGemini(
              img, 
              completedCount, 
              customGeminiKey || null, 
              envGeminiKey, 
              customApiKey || null, 
              geminiState,
              mainKeyword,
              visionProvider
            );
            visionResults.push(res);
            
            if (res.usedGeminiFallback) {
              useGeminiDelay = true;
            }
          } catch (e: any) {
            console.error(`Failed to analyze image "${img.originalName}":`, e.message || e);
            const kwSlug = (mainKeyword || 'hair style').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const imgExt = path.extname(img.originalName).toLowerCase() || '.jpg';
            visionResults.push({
              id: img.id,
              originalName: img.originalName,
              seoFilename: `${kwSlug}-example-${completedCount + 1}${imgExt}`,
              altText: `${mainKeyword || 'Hair style'} - example ${completedCount + 1}`,
              caption: ''
            });
          }
          completedCount++;
          const pct = 15 + Math.round((completedCount / imagesWithBase64.length) * 45); // scales 15% to 60%
          sendProgress(pct, `Analyzed image ${completedCount}/${imagesWithBase64.length}: "${img.originalName}"...`);
          
          // Respect rate limit: 100ms delay for Cloudflare (no rate limit), or 4.5s for Gemini, or 1500ms for OpenCode
          if (completedCount < imagesWithBase64.length) {
            const delayMs = visionProvider === 'cloudflare' ? 100 : (useGeminiDelay ? 4500 : 1500);
            console.log(`[Vision Delay] Waiting ${delayMs}ms before next image...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }

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
- "metaDescription": under 160 characters, natural, includes keyword if possible.
- "slug": lowercase, hyphen-separated, includes main keyword.
- "focusKeyword": use provided keyword (do not change intent).
- "relatedKeywords": 3–5 closely related variations.
- "pinterestTitle": engaging, keyword-focused.
- "pinterestDescription": natural, slightly emotional, SEO-friendly.

Image Matching Rules:
- Use the provided pre-analyzed image data.
- Match images to the most relevant paragraph or section.
- Do NOT guess or force placements.

Each image must include:
- Accurate "placementParagraphIndex"
- Matching "placementHeading" (must exist in article)
- Clear "notes" explaining relevance
- "useImage" = false if not relevant
- Fill "reasonNotUsed" only when false

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
          
          const originalParagraphs = articleContent
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

          // First pass: Add all valid AI-recommended placements
          if (parsedData.imageMatches && Array.isArray(parsedData.imageMatches)) {
            parsedData.imageMatches.forEach((match: any) => {
              const vr = visionResults.find(v => v.id === match.id || v.originalName === match.originalName);
              if (vr) {
                const placementIndex = typeof match.placementParagraphIndex === 'number' && match.placementParagraphIndex >= 0
                  ? Math.min(match.placementParagraphIndex, originalParagraphs.length - 1)
                  : null;
                
                if (match.useImage !== false && placementIndex !== null) {
                  finalImageMatches.push({
                    id: vr.id,
                    originalName: vr.originalName,
                    seoFilename: match.seoFilename || vr.seoFilename,
                    altText: match.altText || vr.altText,
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

              finalImageMatches.push({
                id: vr.id,
                originalName: vr.originalName,
                seoFilename: match?.seoFilename || vr.seoFilename,
                altText: match?.altText || vr.altText || `${mainKeyword || 'Hair style'} - image ${idx + 1}`,
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

        // 1. If user selected an OpenCode model, try it first
        if (selectedModel && !selectedModel.startsWith('gemini-')) {
          const normalizedModel = selectedModel === 'deepseek-v4-flash-free' ? 'deepseek-v4-flash' : selectedModel;
          await tryOpenCodeModel(normalizedModel, 45000);
        }

        // 2. Fall back to other OpenCode models (primary text models)
        if (!responseData) {
          const selectedNormalized = selectedModel === 'deepseek-v4-flash-free' ? 'deepseek-v4-flash' : (selectedModel?.startsWith('gemini-') ? null : selectedModel);
          for (const model of ['mimo-v2.5-free', 'big-pickle', 'deepseek-v4-flash']) {
            if (responseData) break;
            if (model !== selectedNormalized) {
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
        controller.enqueue(encoder.encode(JSON.stringify({
          type: 'success',
          modelUsed: successModel,
          data: responseData
        }) + '\n'));
        
      } catch (e: any) {
        console.error("Analysis stream error:", e);
        controller.enqueue(encoder.encode(JSON.stringify({
          type: 'error',
          error: e.message || 'Failed to analyze post'
        }) + '\n'));
      } finally {
        controller.close();
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
