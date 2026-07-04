import { NextResponse } from 'next/server';
import { getOpenCodeClient } from '@/lib/opencode-client';
import fs from 'fs';
import path from 'path';

export const maxDuration = 60; // Set to 60s max, kept alive by streaming heartbeat
export const dynamic = 'force-dynamic';

function logDebug(message: string) {
  try {
    const logPath = path.join(process.cwd(), 'public', 'api-debug.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    console.log(`[Debug Log] ${message}`);
  } catch (err) {
    console.error('Failed to write debug log:', err);
  }
}

function getGeminiKeys(): string[] {
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

  cleaned = repairTruncatedJson(cleaned);

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  cleaned = escapeUnescapedQuotesInJson(cleaned);
  cleaned = cleaned.replace(/\}\s*\{/g, '},{');
  cleaned = cleaned.replace(/\}\s*"/g, '},"');
  cleaned = cleaned.replace(/"\s*\{/g, '",{');
  cleaned = cleaned.replace(/"\s*"/g, '", "');
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  
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
    console.warn("JSON.parse failed, building fallback values...", parseErr.message);
    throw parseErr;
  }
}

function makeCombinedSignal(clientSignal: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  
  const timeoutId = setTimeout(() => {
    controller.abort(new Error("TimeoutError"));
  }, timeoutMs);
  
  if (clientSignal.aborted) {
    controller.abort();
    clearTimeout(timeoutId);
  } else {
    const handleAbort = () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
    clientSignal.addEventListener('abort', handleAbort);
    
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timeoutId);
        clientSignal.removeEventListener('abort', handleAbort);
      }
    };
  }
  
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
    }
  };
}

export async function POST(request: Request) {
  logDebug("POST /api/analyze/copywriter request received");
  const encoder = new TextEncoder();

  const customStream = new ReadableStream({
    async start(controller) {
      const sendProgress = (progress: number, message: string) => {
        try {
          logDebug(`Progress ${progress}%: ${message}`);
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'progress', progress, message }) + '\n'));
        } catch (e) {}
      };

      // Heartbeat to prevent Netlify/Vercel/browser gateways from timing out (10s limit)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(' \n'));
        } catch (e) {
          clearInterval(heartbeat);
        }
      }, 1500);

      // Listen for client disconnect/abort to stop API requests immediately
      request.signal.addEventListener('abort', () => {
        logDebug("Client disconnected/aborted request. Cleaning up stream resources.");
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch (err) {}
      });

      try {
        const body = await request.json();
        const {
          articleContent,
          mainKeyword = '',
          relatedKeywords = '',
          existingPostsText: customExistingPostsText = '',
          visionResults = [],
          customApiKey = null,
          customGeminiKey = null,
          selectedModel = 'big-pickle',
          wpUrl = ''
        } = body;

        logDebug(`Stream started. focusKeyword="${mainKeyword}", selectedModel="${selectedModel}", imagesCount=${visionResults.length}`);

        if (!articleContent) {
          logDebug("Error: articleContent is missing");
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', error: 'Article content is required' }) + '\n'));
          clearInterval(heartbeat);
          controller.close();
          return;
        }

        // Fetch existing posts from WordPress for internal linking context
        let existingPostsText = customExistingPostsText;
        if (wpUrl && !existingPostsText) {
          try {
            const cleanWpUrl = wpUrl.replace(/\/$/, "");
            sendProgress(62, `Fetching existing WordPress posts from ${cleanWpUrl}...`);
            const wpRes = await fetch(`${cleanWpUrl}/wp-json/wp/v2/posts?per_page=15&_fields=title,link`, {
              signal: AbortSignal.timeout(4000)
            });
            if (wpRes.ok) {
              const wpPosts = await wpRes.json();
              if (Array.isArray(wpPosts) && wpPosts.length > 0) {
                existingPostsText = wpPosts.map(p => `- Link Target URL: "${p.link}" | Topic/Title: "${p.title?.rendered || ''}"`).join('\n');
                logDebug(`Found ${wpPosts.length} posts for interlinking`);
              }
            } else {
              logDebug(`WordPress posts fetch failed with status: ${wpRes.status}`);
            }
          } catch (wpErr: any) {
            logDebug(`WordPress posts fetch exception: ${wpErr.message}`);
          }
        }

        sendProgress(65, `Preparing prompts for copywriter model: ${selectedModel}...`);

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
   - You MUST include at least 2 internal links, maximum 4.
   - If fewer than 2 natural opportunities exist, find the 2 most relevant phrases to link.
   - Use 1–3 word phrases only.
   - Do NOT repeat the same URL more than once.
   - FAILURE to include at least 2 internal links is UNACCEPTABLE.

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
* CRITICAL: NEVER output generic option-lists (like 'highlights, lowlights, balayage, toner, or gloss' or 'layers, curls, or braids'). You must commit to EXACTLY ONE specific color, cut, or technique visible in the image, or do not mention it. Do not list possibilities with 'or'.
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
* BANNED generic filenames — REJECT and rewrite if the vision model gave any of these:
  hair-style.jpg, long-hair-style.jpg, short-hair-style.jpg, hairstyle-photo.jpg,
  hair-style-woman.jpg, long-hair-style-24.jpg, short-hair-style-8.jpg, hairstyle-analysis.jpg,
  or any filename containing 'woman', 'image', 'photo', 'picture'.
* Do not use words like woman, image, photo, the, has, of, with, girl, model.
* Keep filename specific to the matched section topic.
* GOOD examples: copper-balayage-face-framing.jpg, gray-blending-demi-formula.jpg, curly-dimensional-highlights.jpg

ALT TEXT RULES:
* Must focus ENTIRELY on the hair — this is the most critical rule.
* Must describe hair texture, hair color, foiling placement, color dimension, regrowth, tone, gloss, gray blending, cut, or styling technique.
* ABSOLUTE BAN LIST — NEVER include any of these words in alt text:
  woman, girl, man, person, model, client, shirt, sweater, blouse, dress, earrings, necklace,
  hair tie, sitting, standing, selfie, posing, wearing, room, bed, bedroom, chair, mirror,
  wall, background, sofa, window, photo, image, picture, face, smile, eyes, green shirt, blue shirt.
* If the vision model's alt text mentions ANY banned word, you MUST rewrite it from scratch focusing only on hair.
* Must connect the image to the matched article section.
* Must not repeat the same structure for every image.
* Must be unique, natural, professional, and search-friendly.
* Length: 80-140 characters ideal.
* Do not keyword stuff.

GOOD ALT TEXT EXAMPLES:
* Fine color-treated hair with soft face-framing placement for a lighter regrowth line.
* Curly hair showing dimensional color placement for texture and movement.
* Dark brunette with seamless gray blending using demi-permanent formula.
* Copper balayage with warm tones blended through mid-lengths and ends.
* Short layered cut with glossy toner refresh and natural color dimension.

BAD ALT TEXT EXAMPLES (REJECT THESE):
* A woman with long, dark hair wearing a green shirt and a colorful hair tie.
* A woman with long, curly hair in a blue shirt, sitting on a bed.
* A woman with short hair taking a selfie in front of a mirror.
* A woman with long black hair in a green sweater, showcasing her hairstyle.

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

        const preAnalyzedImagesText = visionResults
          .map((vr: any) => `Image ID: ${vr.id}\nOriginal Name: ${vr.originalName}\nHair Description: ${vr.visualDescription || vr.altText || 'Hair style image — no visual description available'}`)
          .join('\n\n');

        let userContent = `Here is the article details.
Main Keyword: "${mainKeyword}"
Related Keywords Input: "${relatedKeywords}"

Here is the article text, paragraph-by-paragraph:
${paragraphListText}

Below are the uploaded images with their hair descriptions from visual AI analysis.
You are the SEO authority: generate the final seoFilename, altText, and caption for each image based on these descriptions and the article context. Do NOT copy the description verbatim — optimize it for SEO.

Pre-Analyzed Images List:
${preAnalyzedImagesText}`;

        if (existingPostsText) {
          userContent += `\n\nExisting Site Posts (Use these for creating internal links naturally, do not change any words):\n${existingPostsText}`;
        }

        let responseData: any = null;
        let successModel = '';
        let lastError: any = null;

        // Helper: try Gemini
        const tryGemini = async (geminiModel: string, apiKey: string) => {
          if (responseData) return;
          if (request.signal.aborted) {
            logDebug(`Request aborted by client. Skipping Gemini model ${geminiModel}.`);
            return;
          }
          const combined = makeCombinedSignal(request.signal, 180000);
          try {
            sendProgress(70, `Submitting request to Gemini model: ${geminiModel}...`);
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
                signal: combined.signal
              }
            );
            logDebug(`Gemini response status: ${geminiRes.status}`);
            if (geminiRes.status === 200) {
              const geminiData = await geminiRes.json();
              const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (rawText) {
                logDebug(`Gemini model ${geminiModel} returned content. Parsing...`);
                responseData = extractFlexibleJson(rawText);
                successModel = geminiModel;
                logDebug(`Gemini model ${geminiModel} success!`);
              } else {
                logDebug(`Gemini model ${geminiModel} returned empty content.`);
              }
            } else {
              const errText = await geminiRes.text();
              logDebug(`Gemini model ${geminiModel} error body: ${errText.substring(0, 200)}`);
            }
          } catch (err: any) {
            logDebug(`Gemini text model ${geminiModel} failed: ${err.message}`);
            lastError = err;
          } finally {
            combined.cleanup();
          }
        };

        // Helper: try OpenCode
        const tryOpenCodeModel = async (modelName: string) => {
          if (responseData) return;
          if (request.signal.aborted) {
            logDebug(`Request aborted by client. Skipping OpenCode model ${modelName}.`);
            return;
          }
          const combined = makeCombinedSignal(request.signal, 180000);
          try {
            sendProgress(75, `Submitting request to OpenCode model: ${modelName}...`);
            const client = getOpenCodeClient(customApiKey);
            const response = await client.chat.completions.create(
              {
                model: modelName,
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userContent }
                ],
                response_format: { type: "json_object" },
                temperature: 0.2,
                max_tokens: 16384
              },
              { signal: combined.signal }
            );

            const rawText = response.choices?.[0]?.message?.content || '';
            if (rawText) {
              logDebug(`OpenCode model ${modelName} returned content. Parsing...`);
              responseData = extractFlexibleJson(rawText);
              successModel = modelName;
              logDebug(`OpenCode model ${modelName} success!`);
            } else {
              logDebug(`OpenCode model ${modelName} returned empty content.`);
            }
          } catch (err: any) {
            logDebug(`OpenCode text model ${modelName} failed: ${err.message}`);
            lastError = err;
          } finally {
            combined.cleanup();
          }
        };

        // 1. If Gemini model is selected, try that first
        if (selectedModel && selectedModel.startsWith('gemini-')) {
          const keys = customGeminiKey ? [customGeminiKey] : GEMINI_KEYS;
          for (const k of keys) {
            if (responseData) break;
            await tryGemini(selectedModel, k);
          }
        } else {
          // 2. Otherwise try the selected OpenCode model
          await tryOpenCodeModel(selectedModel);
        }

        // 3. Fallback chain: OpenCode default models
        if (!responseData) {
          logDebug("Primary model failed, starting OpenCode fallbacks...");
          const fallbackModels = [
            'big-pickle',
            'minimax-m3',
            'deepseek-v4-flash-free',
            'nemotron-3-ultra-free',
            'north-mini-code-free'
          ];
          for (const m of fallbackModels) {
            if (responseData) break;
            if (m !== selectedModel) {
              await tryOpenCodeModel(m);
            }
          }
        }

        // 4. Fallback chain: Gemini models
        if (!responseData) {
          logDebug("OpenCode fallbacks failed, starting Gemini fallbacks...");
          const geminiModels = ['gemini-2.5-flash', 'gemini-1.5-flash'];
          const keys = customGeminiKey ? [customGeminiKey] : GEMINI_KEYS;
          for (const model of geminiModels) {
            for (const k of keys) {
              if (responseData) break;
              await tryGemini(model, k);
            }
          }
        }

        if (!responseData) {
          logDebug("All models failed. Throwing exception.");
          throw lastError || new Error("All text copywriting models failed to return valid JSON");
        }

        logDebug(`Copywriter processing success with model: ${successModel}`);
        sendProgress(90, "Processing generated post structure and mapping images...");

        // Process responseData and apply the image placement distribution logic
        const parsedData = responseData;
        const cleanParagraphs = articleContent
          .split('\n')
          .map((p: string) => p.trim())
          .filter((p: string) => p.length > 0);

        const formattedParagraphsList = parsedData.formattedParagraphs || [];
        if (Array.isArray(formattedParagraphsList)) {
          for (const item of formattedParagraphsList) {
            if (item && typeof item.index === 'number' && item.index >= 0 && item.index < cleanParagraphs.length) {
              cleanParagraphs[item.index] = item.text;
            }
          }
        }
        parsedData.formattedArticleContent = cleanParagraphs.join('\n\n');
        delete parsedData.formattedParagraphs;

        const finalImageMatches: any[] = [];
        const occupiedIndices = new Set<number>();

        // Sanitize AI-generated image SEO fields — cleanup for template placeholders, backticks, etc.
        const BANNED_FILENAME_RE = /^(hair-style|long-hair-style|short-hair-style|hairstyle-woman|hairstyle-photo|woman-hairstyle|hair-style-woman|medium-hair-style|hairstyle-analysis|seo-filename|name|seo-name)/i;
        const BANNED_FN_WORDS = ['woman', 'photo', 'image', 'picture', 'girl', 'model', 'seo-filename', '[seo', '[name', 'words-lowercase', 'hyphen-separated'];
        const BANNED_ALT_RE = /\b(woman|girl|man|person|model|client|shirt|sweater|blouse|dress|earrings|necklace|hair tie|sitting|standing|selfie|posing|wearing|room|bed|bedroom|chair|mirror|wall|background|sofa|window|photo|image|picture|smile|eyes)\b/gi;

        // Strip template placeholders, backticks, character counts, and instruction text from AI output
        function cleanAIOutput(text: string): string {
          let cleaned = text
            .replace(/^[`*]+|[`*]+$/g, '')                          // leading/trailing backticks/asterisks
            .replace(/`/g, '')                                       // all backticks
            .replace(/\(\d{1,3}\s*characters?\)/gi, '')              // (95 characters)
            .replace(/\d{1,3}\s*chars?\??/gi, '')                    // 95 chars?
            .replace(/\[seo[^\]]*\]/gi, '')                          // [seo filename], [SEO alt text]
            .replace(/\[name\]/gi, '')                               // [name]
            .replace(/\bYes\.?\b/gi, '')                             // Yes
            .replace(/\bNo\.?\b/gi, '')                              // No
            .replace(/Describes ONLY hair\??/gi, '')                  // Describes ONLY hair?
            .replace(/No banned words\??/gi, '')                      // No banned words?
            .replace(/3[- ]5 words[^.]*\./gi, '')                     // 3-5 words, lowercase...
            .replace(/\blowercase\b/gi, '')                          // lowercase
            .replace(/\bhyphen[- ]separated\b/gi, '')                // hyphen-separated
            .replace(/\s*[—–-]\s*$/g, '')                            // trailing dashes
            .replace(/^\s*[—–-]\s*/g, '')                            // leading dashes
            .replace(/\s{2,}/g, ' ')                                 // multiple spaces
            .replace(/^[,.;:\s]+|[,.;:\s]+$/g, '')                   // leading/trailing punctuation
            .trim();

          // Strip or-lists of generic techniques and replace them with natural terms
          const patterns = [
            { regex: /\b(visible\s+)?evidence\s+of\s+curls,\s*braids,\s*balayage,\s*toner,\s*gloss,\s*or\s*lowlights\b/gi, replace: "dimensional tones" },
            { regex: /\b(visible\s+|apparent\s+)?highlights,\s*lowlights,\s*(or\s+)?balayage,\s*toner,\s*or\s*gloss\b/gi, replace: "dimensional color" },
            { regex: /\b(visible\s+|apparent\s+)?highlights,\s*lowlights,\s*balayage,\s*toner,\s*or\s*gloss\b/gi, replace: "dimensional color" },
            { regex: /\b(visible\s+|apparent\s+)?highlights,\s*lowlights,\s*balayage,\s*toner,\s*gloss,\s*curls,\s*braids,\s*or\s*gray\s*blending\b/gi, replace: "blended color" },
            { regex: /\b(visible\s+|apparent\s+)?highlights,\s*lowlights,\s*or\s*balayage\b/gi, replace: "subtle highlights" },
            { regex: /\btoned\/glossed\s+effects\b/gi, replace: "toner refresh" },
            { regex: /\b(regrowth,\s*curls,\s*or\s*dimension|regrowth,\s*gray\s*blending,\s*balayage,\s*toner,\s*or\s*gloss)\b/gi, replace: "natural grow-out" },
            { regex: /\b(layers,\s*curls,\s*or\s*braids|layers,\s*curls,\s*or\s*styling)\b/gi, replace: "layered styling" },
            { regex: /\bcurls,\s*braids,\s*or\s*visible\s*gray\s*blending\b/gi, replace: "textured styling" },
            { regex: /\bgray\s+blending\s+or\s+regrowth\s+visible\b/gi, replace: "soft regrowth blending" },
            { regex: /\bgray\s+blending\s+or\s+regrowth\b/gi, replace: "soft regrowth blending" },
            { regex: /\bcurls,\s*braids,\s*or\s*highlights,\s*lowlights,\s*balayage,\s*toner,\s*or\s*gloss\b/gi, replace: "dimensional highlights" }
          ];

          for (const p of patterns) {
            cleaned = cleaned.replace(p.regex, p.replace);
          }

          cleaned = cleaned.replace(/\s*,\s*or\s+/gi, ' or ').trim();
          return cleaned;
        }

        function sanitizeImageSEO(seoFilename: string, altText: string, fallbackKw: string, visualDesc?: string): { seoFilename: string; altText: string } {
          // Clean up template/backtick artifacts
          seoFilename = cleanAIOutput(seoFilename);
          altText = cleanAIOutput(altText);

          // Fix generic or placeholder filenames
          const fnBase = seoFilename.replace(/\.[^/.]+$/, '').toLowerCase();
          const fnIsGeneric = BANNED_FILENAME_RE.test(fnBase) || BANNED_FN_WORDS.some(w => fnBase.includes(w)) || fnBase.length < 3;
          if (fnIsGeneric && visualDesc) {
            // Derive filename from visual description
            const cleanWords = visualDesc.toLowerCase()
              .replace(/[^a-z0-9\s-]/g, '')
              .split(/\s+/)
              .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'has', 'her', 'his', 'this', 'that', 'from', 'into', 'woman', 'girl', 'photo', 'image', 'hair', 'style', 'shown'].includes(w))
              .slice(0, 5);
            seoFilename = cleanWords.length >= 3 ? cleanWords.join('-') + '.jpg' : `${fallbackKw.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-technique.jpg`;
          }

          // Ensure filename ends with .jpg
          if (!seoFilename.toLowerCase().endsWith('.jpg') && !seoFilename.toLowerCase().endsWith('.jpeg')) {
            seoFilename = seoFilename.replace(/\.[^/.]+$/, '') + '.jpg';
          }

          // Strip banned words from alt text (but NOT 'face' — preserves 'face-framing')
          let clean = altText.replace(BANNED_ALT_RE, '').replace(/\s{2,}/g, ' ').replace(/^[,.\s]+|[,.\s]+$/g, '').replace(/\s*,\s*,/g, ',').trim();
          if (clean.length < 30 && visualDesc) {
            // Use visual description as alt text basis
            clean = visualDesc.substring(0, 140).replace(/\.$/, '') + '.';
          } else if (clean.length < 30) {
            clean = `${seoFilename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')} hairstyle technique`;
          }
          return { seoFilename, altText: clean };
        }

        // Pass 1: Keep AI placed images
        if (parsedData.imageMatches && Array.isArray(parsedData.imageMatches)) {
          parsedData.imageMatches.forEach((match: any) => {
            const vr = visionResults.find((v: any) => v.id === match.id || v.originalName === match.originalName);
            if (vr) {
              const placementIndex = typeof match.placementParagraphIndex === 'number' && match.placementParagraphIndex >= 0
                ? Math.min(match.placementParagraphIndex, cleanParagraphs.length - 1)
                : null;
              
              if (match.useImage !== false && placementIndex !== null) {
                const rawFn = match.seoFilename || vr.seoFilename || '';
                const rawAlt = match.altText || vr.altText || '';
                const sanitized = sanitizeImageSEO(rawFn, rawAlt, mainKeyword || 'hair style', vr.visualDescription);
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

        // Pass 2: Ensure all images are placed somewhere
        const pendingImages: any[] = [];
        visionResults.forEach((vr: any) => {
          const alreadyPlaced = finalImageMatches.some(m => m.id === vr.id);
          if (!alreadyPlaced) {
            pendingImages.push(vr);
          }
        });

        if (pendingImages.length > 0) {
          const availableIndices: number[] = [];
          for (let i = 0; i < cleanParagraphs.length; i++) {
            if (!occupiedIndices.has(i) && !cleanParagraphs[i].startsWith('#')) {
              availableIndices.push(i);
            }
          }

          if (availableIndices.length === 0) {
            for (let i = 0; i < cleanParagraphs.length; i++) {
              if (!cleanParagraphs[i].startsWith('#')) {
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

            const rawFn = match?.seoFilename || vr.seoFilename || '';
            const rawAlt = match?.altText || vr.altText || vr.visualDescription || `${mainKeyword} hair technique ${idx + 1}`;
            const sanitized = sanitizeImageSEO(rawFn, rawAlt, mainKeyword || 'hair style', vr.visualDescription);

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

        // Prevent multiple images from clumping
        finalImageMatches.sort((a, b) => a.placementParagraphIndex - b.placementParagraphIndex);
        const usedIndices = new Set<number>();
        finalImageMatches.forEach((match) => {
          let index = match.placementParagraphIndex;
          while (usedIndices.has(index) || (index < cleanParagraphs.length && cleanParagraphs[index].startsWith('#'))) {
            index++;
          }
          if (index >= cleanParagraphs.length) {
            let found = false;
            for (let k = 0; k < cleanParagraphs.length; k++) {
              if (!usedIndices.has(k) && !cleanParagraphs[k].startsWith('#')) {
                index = k;
                found = true;
                break;
              }
            }
            if (!found) {
              index = cleanParagraphs.length - 1;
            }
          }
          match.placementParagraphIndex = index;
          usedIndices.add(index);
        });

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

        logDebug("Formatting and image distribution completed successfully. Returning streaming success.");
        if (!request.signal.aborted) {
          try {
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'success', data: parsedData }) + '\n'));
          } catch (enqueueErr) {}
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch (closeErr) {}
        } else {
          clearInterval(heartbeat);
        }

      } catch (e: any) {
        logDebug(`CRITICAL ERROR in copywriter endpoint: ${e.message}\nStack: ${e.stack}`);
        if (!request.signal.aborted) {
          try {
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', error: e.message }) + '\n'));
          } catch (enqueueErr) {}
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch (closeErr) {}
        } else {
          clearInterval(heartbeat);
        }
      }
    }
  });

  return new Response(customStream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
