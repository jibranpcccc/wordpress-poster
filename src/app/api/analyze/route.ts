import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getOpenCodeClient } from '@/lib/opencode-client';
import { db } from '@/lib/db';

const GEMINI_KEYS = [
  "AIzaSyCiQ-DLrhWSPrY1mZ0nBaZ0QJbb2E4Unlc",
  "AIzaSyD-suIQxkXxQTWr09_8g2KGZzTpuXlxShw",
  "AIzaSyD0SNf-kWaosjkhj5_tvlk80FkAQi5TXtQ",
  "AIzaSyAN-SxLvrjM0YDOpRWUtUg3ye5_ysBtNyo"
];

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
        while (j < jsonStr.length) {
          const nextChar = jsonStr[j];
          if (/\s/.test(nextChar)) {
            j++;
            continue;
          }
          if (nextChar === ',' || nextChar === '}' || nextChar === ']' || nextChar === ':') {
            isEndOfString = true;
          }
          break;
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

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  // Escape unescaped double quotes inside string values
  cleaned = escapeUnescapedQuotesInJson(cleaned);

  // Remove trailing commas in arrays and objects
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  
  // Escape raw newlines inside string properties
  return escapeRawNewlinesInJsonString(cleaned);
}

// Visual analysis helper using user-supplied Gemini keys with key rotation
async function analyzeImageWithGemini(
  img: { id: string; originalName: string; base64: string; ext: string },
  imageIndex: number
) {
  let base64Data = img.base64;
  if (base64Data.includes(';base64,')) {
    base64Data = base64Data.split(';base64,')[1];
  }
  
  const mimeType = img.ext === 'png' ? 'image/png' : img.ext === 'webp' ? 'image/webp' : 'image/jpeg';
  
  // Try keys in rotation starting from index
  for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
    const keyIndex = (imageIndex + attempt) % GEMINI_KEYS.length;
    const apiKey = GEMINI_KEYS[keyIndex];
    
    console.log(`Analyzing image "${img.originalName}" with Gemini key index ${keyIndex}...`);
    
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: 'Analyze this post image. Suggest a short SEO-friendly filename (lowercase, hyphen-separated, ending in original extension) and a descriptive SEO alt tag describing the hair color, haircut, or style. Return JSON like: {"seoFilename": "...", "altText": "...", "caption": "..."}' },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Data
                }
              }
            ]
          }],
          generationConfig: {
            responseMimeType: 'application/json'
          }
        }),
        signal: AbortSignal.timeout(12000) // 12s timeout
      });
      
      if (res.status === 200) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text.trim());
          console.log(`Success analyzing "${img.originalName}":`, parsed);
          return {
            id: img.id,
            originalName: img.originalName,
            seoFilename: parsed.seoFilename || img.originalName,
            altText: parsed.altText || '',
            caption: parsed.caption || ''
          };
        }
      } else {
        const errText = await res.text();
        console.warn(`Key index ${keyIndex} failed for "${img.originalName}" with status ${res.status}: ${errText}`);
      }
    } catch (e: any) {
      console.warn(`Exception using key index ${keyIndex} for "${img.originalName}": ${e.message}`);
    }
  }
  
  // Text-only fallback if all Gemini vision keys are exhausted
  console.warn(`All Gemini vision keys failed for "${img.originalName}". Using text fallback.`);
  const cleanName = img.originalName.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
  return {
    id: img.id,
    originalName: img.originalName,
    seoFilename: img.originalName.toLowerCase().replace(/[^a-z0-9.]+/g, '-'),
    altText: `Image showing ${cleanName}`,
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
        const { projectId, articleContent, mainKeyword, relatedKeywords, images, customApiKey, model: selectedModel, wpUrl } = await request.json();

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

            // Fallback to local file if not loaded from Firestore
            if (!base64Data) {
              const fullPath = path.join(uploadDir, img.localPath);
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

        // 2. Perform parallel Gemini vision analysis (free visual inspection task)
        sendProgress(15, `Starting visual analysis of ${imagesWithBase64.length} images...`);
        let completedImages = 0;
        const visionPromises = imagesWithBase64.map(async (img, idx) => {
          const res = await analyzeImageWithGemini(img, idx);
          completedImages++;
          const pct = 15 + Math.round((completedImages / imagesWithBase64.length) * 45); // scales 15% to 60%
          sendProgress(pct, `Analyzed image ${completedImages}/${imagesWithBase64.length}: "${img.originalName}"...`);
          return res;
        });
        const visionResults = await Promise.all(visionPromises);

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
Your task is to review the pre-analyzed images, format the provided article text, and output SEO optimizations.

SEO Title Rules:
- The generated "seoTitle" MUST contain the provided Focus Keyword (mainKeyword) naturally. It should be 100% related to your focus keyword and optimized for search click-through rate.

Post Formatting Rules:
- CRITICAL: You MUST NOT rewrite, change, delete, or modify even a single letter or word of the original article content. Every word of the text must remain 100% identical.
- You are ONLY allowed to add markdown formatting:
  1. Heading wraps (## / ###)
  2. Bold (**word**) and Italic (*word*)
  3. Internal Links ([word or phrase](URL)) pointing to existing posts on our site.
- Bold/Italic Quota: You MUST add bold (**...**) to at least 5-8 key entities, keywords, or main concepts across the article, and italic (*...*) to 3-5 styling concepts. Do not leave the article without bold or italic formatting.
- Internal Linking:
  * Check the "Existing Site Posts" list provided in the user prompt.
  * You MUST find at least 2-3 opportunities to add internal links to these posts.
  * To make it easy, you can link short topic terms (1-3 words) that relate to the topic of the existing posts.
  * Examples:
    - If you see the words "reds", "red", or "copper", wrap it in a link to a post about red hair ideas: e.g., [reds](https://hairtrendspot.com/hair-color/red-hair-color-ideas/)
    - If you see "balayage" or "foilyage", wrap it in a link to a post about balayage or layered haircuts.
    - If you see "foils" or "foiling", wrap it in a link to a post about foil placement.
  * Do NOT change, insert, or delete any letters or words. Just wrap the existing words in the markdown link syntax.
  * Aim for 2-4 internal links in total across the entire article.
- Under the "formattedParagraphs" property, you MUST ONLY return the paragraphs that you modified or formatted.
- For each formatted paragraph, provide its 0-based "index" matching the input list, and the formatted "text".
- Do NOT include any unchanged paragraphs in "formattedParagraphs". This keeps the response compact and prevents truncation.
- Keep the original paragraph structure completely intact.

JSON Formatting Rules:
- CRITICAL: Do NOT use raw double quotes (") inside any JSON string property value. Use single quotes (') instead.
- Example of WRONG: "altText": "A woman with "rose brown" hair"
- Example of CORRECT: "altText": "A woman with 'rose brown' hair"
- Raw double quotes inside JSON values will break the parser.

Output Format:
You MUST respond strictly with a valid JSON object matching the schema below. Do not wrap it in anything else besides standard JSON formatting.

Schema:
{
  "seoTitle": "A main SEO Title (under 60 characters)",
  "metaDescription": "A compelling meta description (under 160 characters)",
  "slug": "url-slug-hyphen-separated",
  "focusKeyword": "Main keyword (use the one provided if relevant)",
  "relatedKeywords": ["keyword1", "keyword2", "keyword3"],
  "pinterestTitle": "Pinterest Pin Title",
  "pinterestDescription": "Pinterest Pin Description",
  "featuredImageId": "The ID of the image recommended to be the Featured Image",
  "formattedParagraphs": [
    {
      "index": 0,
      "text": "Formatted text of the paragraph, containing 100% identical words with heading/bold/italic/links style added."
    }
  ],
  "imageMatches": [
    {
      "id": "The ID of the uploaded image",
      "originalName": "The original filename",
      "seoFilename": "Suggest new-seo-friendly-name.ext (use or refine the Gemini suggested one)",
      "altText": "Suggest alt text (use or refine the Gemini suggested one)",
      "caption": "Suggest caption (use or refine the Gemini suggested one)",
      "placementParagraphIndex": 3, // 0-based index of the paragraph in the article after which this image should go
      "placementHeading": "Text of the heading under which this image fits",
      "notes": "Brief explanation of why this image matches this section",
      "useImage": true, // false if it does not fit the article content at all
      "reasonNotUsed": "" // filled only if useImage is false
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

        // Fallbacks: Prioritize user-selected model, then DeepSeek, then Qwen, then MiniMax, then Big-Pickle
        const modelsToTry = [];
        if (selectedModel) modelsToTry.push(selectedModel);
        
        const standardModels = [
          'deepseek-v4-flash-free',
          'qwen3.6-plus-free',
          'mimo-v2.5-free',
          'big-pickle'
        ];
        
        for (const m of standardModels) {
          if (!modelsToTry.includes(m)) {
            modelsToTry.push(m);
          }
        }

        let responseData = null;
        let successModel = '';
        let lastError: any = null;

        for (const model of modelsToTry) {
          try {
            sendProgress(75, `Submitting copywriter request to text model: ${model}...`);
            
            const response = await client.chat.completions.create({
              model: model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
              ],
              response_format: { type: "json_object" },
              temperature: 0.2,
              max_tokens: 4000
            });

            const rawText = response.choices[0]?.message?.content || '';
            console.log(`Success with text model: ${model}`);
            
            // Robust cleanup and JSON parse
            const cleanJsonText = cleanJsonString(rawText);
            try {
              const parsedData = JSON.parse(cleanJsonText);
              
              sendProgress(92, "Formatting response. Reconstructing full layout...");
              // Reconstruct formattedArticleContent in the backend
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
              delete parsedData.formattedParagraphs; // clean up metadata
              
              responseData = parsedData;
              successModel = model;
              break;
            } catch (parseErr: any) {
              console.error(`JSON Parse failed for model ${model}. Raw text length: ${rawText.length}. Cleaned length: ${cleanJsonText.length}`);
              throw parseErr;
            }
          } catch (err: any) {
            console.error(`Text model ${model} failed:`, err.message || err);
            lastError = err;
          }
        }

        if (!responseData) {
          throw new Error(`All text models failed. Last error: ${lastError?.message || lastError}`);
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
