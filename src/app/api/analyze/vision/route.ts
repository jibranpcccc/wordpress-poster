import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';

export const maxDuration = 10;
export const dynamic = 'force-dynamic';

// Load Cloudflare credentials
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
    .replace(/^```[a-z]*\n?/gm, '')
    .replace(/\n?```$/gm, '')
    .replace(/^[`]+|[`]+$/g, '')
    .replace(/^\*+\s*/gm, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Cascade Vision Runner: Llama 4 Scout -> Llama 3.2 Vision -> LLava 1.5
async function describeHairWithCloudflare(
  img: { id: string; originalName: string; base64: string; ext: string },
  mainKeyword?: string
) {
  let base64Data = img.base64;
  if (base64Data.includes(';base64,')) {
    base64Data = base64Data.split(';base64,')[1];
  }

  const mimeType = img.ext === 'png' ? 'image/png' : img.ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${base64Data}`;
  const buffer = Buffer.from(base64Data, 'base64');
  const byteArray = Array.from(new Uint8Array(buffer));

  const creds = getCloudflareCredentials();
  if (creds.length === 0) {
    throw new Error("No Cloudflare credentials found");
  }

  // Shuffle keys to distribute rate limits
  const startIdx = Math.floor(Math.random() * creds.length);
  const orderedCreds = [...creds.slice(startIdx), ...creds.slice(0, startIdx)];

  const promptText = `Describe ONLY the hair visible in this image in 2-3 detailed sentences. Focus on: hair color, length, texture, highlights, lowlights, balayage, toner, gloss, cut style, layers, curls, braids, face-framing, dimension, gray blending, regrowth. Do NOT mention people, faces, clothing, accessories, background, room, or furniture.`;

  // Define models in order of quality/efficiency preference
  // 1. Llama 4 Scout (17B) - extremely fast, state-of-the-art vision
  // 2. Llama 3.2 Vision (11B) - excellent quality, descriptive
  // 3. LLava 1.5 (7B) - fast baseline fallback
  const models = [
    { name: 'llama-4-scout-17b', endpoint: '@cf/meta/llama-4-scout-17b-16e-instruct', type: 'chat' },
    { name: 'llama-3.2-11b-vision', endpoint: '@cf/meta/llama-3.2-11b-vision-instruct', type: 'chat' },
    { name: 'llava-1.5-7b', endpoint: '@cf/llava-hf/llava-1.5-7b-hf', type: 'legacy' }
  ];

  // Attempt models sequentially, each using the key pool
  for (const model of models) {
    console.log(`[Vision] Trying model "${model.name}" for image "${img.originalName}"...`);
    
    for (const cred of orderedCreds) {
      try {
        const url = `https://api.cloudflare.com/client/v4/accounts/${cred.acc}/ai/run/${model.endpoint}`;
        let res;

        if (model.type === 'chat') {
          res = await fetch(url, {
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
                    { type: "text", text: promptText },
                    { type: "image_url", image_url: { url: dataUrl } }
                  ]
                }
              ],
              max_tokens: 256
            }),
            signal: AbortSignal.timeout(15000) // 15s timeout for fast failover
          });
        } else {
          // Legacy LLava byte-array format
          res = await fetch(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${cred.key}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              image: byteArray,
              prompt: promptText,
              max_tokens: 256
            }),
            signal: AbortSignal.timeout(15000)
          });
        }

        if (res.status === 200) {
          const data = await res.json();
          let desc = '';
          
          if (model.type === 'chat') {
            const choices = data.result?.choices || data.choices;
            desc = (choices?.[0]?.message?.content || data.result?.response || '').trim();
          } else {
            desc = (data.result?.description || '').trim();
          }

          if (desc && desc.length > 10) {
            const cleaned = cleanVisionText(desc);
            console.log(`[Vision] SUCCESS using "${model.name}" (Key #${cred.index}): ${cleaned.substring(0, 85)}...`);
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
          const errMsg = await res.text().catch(() => '');
          console.warn(`[Vision] "${model.name}" (Key #${cred.index}) status ${res.status}: ${errMsg.substring(0, 100)}`);
        }
      } catch (err: any) {
        console.warn(`[Vision] "${model.name}" (Key #${cred.index}) failed: ${err.message}`);
      }
    }
  }

  throw new Error("All Cloudflare Worker AI models and keys in cascade failed");
}

export async function POST(request: Request) {
  let image: any = null;
  let mainKeyword = '';
  try {
    const body = await request.json();
    image = body.image;
    mainKeyword = body.mainKeyword || '';

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

    // 2. Load from local filesystem
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

    // Run cascade: Llama 4 -> Llama 3.2 -> LLava
    const res = await describeHairWithCloudflare(imgObj, mainKeyword);
    return NextResponse.json(res);

  } catch (e: any) {
    console.error("[Vision Route Error]:", e);
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
