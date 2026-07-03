import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';

export const maxDuration = 10;
export const dynamic = 'force-dynamic';

function getGeminiKeys(): string[] {
  const keys: string[] = [];
  for (let i = 1; i <= 50; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`] || process.env[`GEMINI_API_KEY`];
    if (k) keys.push(k.trim());
  }
  return keys;
}

const GEMINI_KEYS = getGeminiKeys();

function getCloudflareCredentials() {
  const creds: { key: string; acc: string; index: number }[] = [];
  for (let i = 1; i <= 150; i++) {
    const key = process.env[`CLOUDFLARE_API_KEY_${i}`];
    const acc = process.env[`CLOUDFLARE_ACCOUNT_ID_${i}`];
    if (key && acc) {
      creds.push({ key: key.trim(), acc: acc.trim(), index: i });
    }
  }
  return creds;
}

// Strip markdown artifacts from vision model output
function cleanVisionText(text: string): string {
  return text
    .replace(/^```[a-z]*\n?/gm, '')   // opening code fences
    .replace(/\n?```$/gm, '')           // closing code fences
    .replace(/^[`]+|[`]+$/g, '')        // leading/trailing backticks
    .replace(/^\*+\s*/gm, '')           // bullet asterisks
    .replace(/^#+\s*/gm, '')            // heading hashes
    .replace(/\*\*/g, '')               // bold markers
    .replace(/\n{3,}/g, '\n\n')         // excessive newlines
    .trim();
}

// Cloudflare Gemma-4 Vision — SIMPLE hair description only
async function describeHairWithCloudflare(
  img: { id: string; originalName: string; base64: string; ext: string },
  mainKeyword?: string
) {
  let base64Data = img.base64;
  if (base64Data.includes(';base64,')) {
    base64Data = base64Data.split(';base64,')[1];
  }

  const creds = getCloudflareCredentials();
  if (creds.length === 0) {
    throw new Error("No Cloudflare credentials found");
  }

  const startIdx = Math.floor(Math.random() * creds.length);
  const ordered = [...creds.slice(startIdx), ...creds.slice(0, startIdx)];

  const mimeType = img.ext === 'png' ? 'image/png' : img.ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  // SIMPLE prompt — just describe what you see. No SEO, no formatting rules.
  const prompt = `Describe ONLY the hair visible in this image in 2-3 short sentences.

Focus on: hair length, texture, color, highlights, lowlights, balayage, foils, toner, gloss, cut style, layers, curls, braids, regrowth, gray blending, color placement, face-framing, dimension.

Do NOT mention: people, faces, expressions, clothing, accessories, background, room, furniture, camera, or poses. Only describe the hair itself.

Example: "Shoulder-length wavy brunette hair with golden balayage highlights through mid-lengths and ends. Soft face-framing layers add dimension. Natural root shadow blends into warm caramel tones."`;

  for (const cred of ordered) {
    try {
      console.log(`[Vision] Describing hair in "${img.originalName}" via Cloudflare Key #${cred.index}...`);
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
          max_tokens: 512
        }),
        signal: AbortSignal.timeout(45000)
      });

      if (res.status === 200) {
        const data = await res.json();
        const choices = data.result?.choices || data.choices;
        const desc = (choices?.[0]?.message?.content || choices?.[0]?.text || '').trim();
        if (desc && desc.length > 10) {
          const cleaned = cleanVisionText(desc);
          console.log(`[Vision] Got description for "${img.originalName}": ${cleaned.substring(0, 80)}...`);
          return {
            id: img.id,
            originalName: img.originalName,
            visualDescription: cleaned,
            seoFilename: '',
            altText: '',
            caption: ''
          };
        }
      } else {
        console.warn(`[Vision] Cloudflare Key #${cred.index} returned status ${res.status}`);
      }
    } catch (e: any) {
      console.warn(`[Vision] Cloudflare Key #${cred.index} error: ${e.message}`);
    }
  }

  throw new Error("All Cloudflare vision keys failed");
}

// Gemini Vision Fallback — same simple description prompt
async function describeHairWithGemini(
  img: { id: string; originalName: string; base64: string; ext: string },
  customGeminiKey: string | null,
  mainKeyword?: string
) {
  let base64Data = img.base64;
  if (base64Data.includes(';base64,')) {
    base64Data = base64Data.split(';base64,')[1];
  }

  const keys = customGeminiKey ? [customGeminiKey] : GEMINI_KEYS;
  if (keys.length === 0) {
    throw new Error("No Gemini keys found");
  }

  const start = Math.floor(Math.random() * keys.length);
  const orderedKeys = [...keys.slice(start), ...keys.slice(0, start)];

  const mimeType = img.ext === 'png' ? 'image/png' : img.ext === 'webp' ? 'image/webp' : 'image/jpeg';

  const promptText = `Describe ONLY the hair visible in this image in 2-3 short sentences. Focus on hair length, texture, color, highlights, lowlights, balayage, foils, toner, gloss, cut style, layers, curls, braids, regrowth, gray blending, color placement, face-framing, dimension. Do NOT mention people, faces, clothing, accessories, background, room, or camera. Only describe the hair.`;

  for (const apiKey of orderedKeys) {
    try {
      console.log(`[Vision] Describing hair in "${img.originalName}" via Gemini...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: promptText },
                {
                  inlineData: {
                    mimeType: mimeType,
                    data: base64Data
                  }
                }
              ]
            }
          ]
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (res.status === 200) {
        const result = await res.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text && text.trim().length > 10) {
          const cleaned = cleanVisionText(text.trim());
          return {
            id: img.id,
            originalName: img.originalName,
            visualDescription: cleaned,
            seoFilename: '',
            altText: '',
            caption: ''
          };
        }
      }
    } catch (e: any) {
      console.warn(`[Vision] Gemini key error: ${e.message}`);
    }
  }

  throw new Error("All Gemini keys failed");
}

export async function POST(request: Request) {
  let image: any = null;
  let mainKeyword = '';
  try {
    const body = await request.json();
    image = body.image;
    mainKeyword = body.mainKeyword || '';
    const customGeminiKey = body.customGeminiKey;
    const visionProvider = body.visionProvider || 'cloudflare';

    if (!image) {
      return NextResponse.json({ error: 'Image details are required' }, { status: 400 });
    }

    console.log(`[Vision] Received request for "${image.originalName}"...`);

    // Prepare image base64
    let base64Data = '';
    let ext = 'jpg';

    // 1. Load from Firestore if it contains ?id=
    if (image.localPath.includes('?id=')) {
      const urlObj = new URL(image.localPath, 'http://localhost');
      const imageId = urlObj.searchParams.get('id');
      if (imageId) {
        const imgAsset = await db.getImage(imageId);
        if (imgAsset) {
          base64Data = imgAsset.base64Data;
          ext = path.extname(imageId).replace('.', '').toLowerCase();
        }
      }
    }

    // 2. Load from local cache / filesystem uploads folder if not loaded
    const uploadDir = path.join(process.cwd(), 'public');
    if (!base64Data) {
      const cachedPath = path.join(uploadDir, 'uploads', image.originalName);
      if (fs.existsSync(cachedPath)) {
        const fileBuffer = fs.readFileSync(cachedPath);
        base64Data = fileBuffer.toString('base64');
        ext = path.extname(cachedPath).replace('.', '').toLowerCase();
      }
    }

    if (!base64Data) {
      const fullPath = path.join(uploadDir, image.localPath.replace(/^\//, ''));
      if (fs.existsSync(fullPath)) {
        const fileBuffer = fs.readFileSync(fullPath);
        base64Data = fileBuffer.toString('base64');
        ext = path.extname(image.localPath).replace('.', '').toLowerCase();
      }
    }

    if (!base64Data) {
      throw new Error(`Could not find image source data for "${image.originalName}"`);
    }

    const imgObj = {
      id: image.id,
      originalName: image.originalName,
      base64: base64Data,
      ext
    };

    // Run Cloudflare Gemma-4 vision or Gemini fallback
    if (visionProvider === 'cloudflare') {
      try {
        const res = await describeHairWithCloudflare(imgObj, mainKeyword);
        return NextResponse.json(res);
      } catch (cfErr: any) {
        console.warn(`[Vision] Cloudflare failed, falling back to Gemini: ${cfErr.message}`);
      }
    }

    // Fallback to Gemini
    const res = await describeHairWithGemini(imgObj, customGeminiKey, mainKeyword);
    return NextResponse.json(res);

  } catch (e: any) {
    console.error("[Vision Route Error]:", e);
    // Return a descriptive fallback based on original filename
    const cleanStem = (image?.originalName || 'image').replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').replace(/\d{10,}/g, '').trim();
    const fallback = {
      id: image?.id || 'img_err',
      originalName: image?.originalName || 'image.jpg',
      visualDescription: `Hair style shown in ${cleanStem || 'uploaded photo'}.`,
      seoFilename: '',
      altText: '',
      caption: '',
      error: e.message
    };
    return NextResponse.json(fallback);
  }
}
