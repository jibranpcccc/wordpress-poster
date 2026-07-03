import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';

export const maxDuration = 10;
export const dynamic = 'force-dynamic';

// Post-processing: Validate and sanitize vision AI outputs
const BANNED_FILENAME_PATTERNS = /^(hair-style|long-hair-style|short-hair-style|hairstyle-woman|hairstyle-photo|woman-hairstyle|hair-style-woman|medium-hair-style)/i;
const GENERIC_FILENAME_PARTS = ['woman', 'photo', 'image', 'picture', 'girl', 'model', 'style-woman'];
const BANNED_ALT_WORDS = ['woman', 'girl', 'man', 'person', 'model', 'client', 'shirt', 'sweater', 'blouse', 'dress', 'earrings', 'necklace', 'hair tie', 'sitting', 'standing', 'selfie', 'posing', 'wearing', 'room', 'bed', 'bedroom', 'chair', 'mirror', 'wall', 'background', 'sofa', 'window', 'photo', 'image', 'picture', 'face', 'smile', 'eyes', 'green shirt', 'blue shirt', 'taking a selfie', 'in front of'];

function sanitizeVisionOutput(seoFilename: string, altText: string, mainKeyword: string): { seoFilename: string; altText: string } {
  // Validate filename: reject if generic
  const fnameBase = seoFilename.replace(/\.[^/.]+$/, '').toLowerCase();
  const isGeneric = BANNED_FILENAME_PATTERNS.test(fnameBase) || GENERIC_FILENAME_PARTS.some(p => fnameBase.includes(p));
  if (isGeneric) {
    // Try to derive a better filename from the alt text
    const words = altText.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !['the', 'and', 'for', 'with', 'has', 'her', 'his'].includes(w))
      .slice(0, 5);
    if (words.length >= 3) {
      seoFilename = words.join('-') + '.jpg';
    } else {
      const kwSlug = (mainKeyword || 'hair-style').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      seoFilename = `${kwSlug}-color-technique.jpg`;
    }
  }

  // Sanitize alt text: remove sentences containing banned words
  let cleanAlt = altText;
  for (const banned of BANNED_ALT_WORDS) {
    const regex = new RegExp(`\\b${banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (regex.test(cleanAlt)) {
      // Remove the banned word and surrounding context
      cleanAlt = cleanAlt.replace(regex, '').replace(/\s{2,}/g, ' ').trim();
    }
  }
  // Clean up any trailing/leading commas or periods from removal
  cleanAlt = cleanAlt.replace(/^[,.\s]+|[,.\s]+$/g, '').replace(/\s*,\s*,/g, ',').trim();

  // If alt text was gutted, use the seoFilename stem as fallback
  if (cleanAlt.length < 30) {
    const stem = seoFilename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
    cleanAlt = `${stem} — ${mainKeyword || 'hairstyle'} inspiration`;
  }

  return { seoFilename, altText: cleanAlt };
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

// Helper to shuffle / load Cloudflare keys
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

// Cloudflare Workers AI Llava
async function analyzeImageWithCloudflare(
  img: { id: string; originalName: string; base64: string; ext: string },
  mainKeyword?: string
) {
  let base64Data = img.base64;
  if (base64Data.includes(';base64,')) {
    base64Data = base64Data.split(';base64,')[1];
  }

  const creds = getCloudflareCredentials();
  if (creds.length === 0) {
    throw new Error("No Cloudflare credentials found in environment variables");
  }

  const startIdx = Math.floor(Math.random() * creds.length);
  const ordered = [...creds.slice(startIdx), ...creds.slice(0, startIdx)];

  const buffer = Buffer.from(base64Data, 'base64');
  const imageArray = Array.from(buffer);

  const kw = mainKeyword || "Hair Style";
  const prompt = `Analyze this hairstyle image for image SEO. Focus ONLY on the hair visible in this image.

Focus keyword: "${kw}"

Your job is to generate exactly:
One short SEO filename.
One search-optimized SEO alt text.

CRITICAL RULES — WHAT TO IGNORE (ABSOLUTE BAN LIST):
You MUST NOT mention ANY of the following in the filename or alt text:
- Clothing: shirt, sweater, blouse, jacket, dress, top, outfit, green shirt, blue shirt
- Accessories: earrings, necklace, hair tie, colorful hair tie, glasses, hat
- Body/Face: woman, girl, man, person, model, client, subject, face, smile, eyes, skin, hands
- Poses/Actions: sitting, standing, selfie, taking a photo, posing, looking, wearing
- Environment: room, bed, bedroom, chair, mirror, wall, background, sofa, window, outdoor, indoor
- Camera: photo, image, picture, shot, camera
If you mention ANY banned word above, your response is INVALID.

WHAT TO DESCRIBE (REQUIRED — HAIR ONLY):
Analyze and describe ONLY these visible hair properties:
- Hair length (long, medium, short, shoulder-length, chin-length)
- Hair texture (straight, wavy, curly, coily, fine, thick, coarse)
- Hair color (blonde, brunette, auburn, copper, black, gray, platinum, ombre, balayage)
- Color technique (highlights, lowlights, foils, babylights, color melt, shadow root, gloss, toner)
- Cut/Style (layers, bob, pixie, bangs, face-framing, stacked, blunt cut, shag)
- Color placement (face-framing, crown, mid-lengths, ends, root blend, regrowth line)
- Condition (glossy, matte, dimensional, blended, seamless, natural-looking)

FILENAME RULES:
3-5 words only, lowercase, hyphen-separated, ending in .jpg.
Must describe the specific hairstyle, color, or technique visible.
BAD examples: hair-style.jpg, long-hair-style.jpg, woman-hairstyle.jpg, hairstyle-photo.jpg
GOOD examples: copper-balayage-face-framing.jpg, gray-blending-demi-permanent.jpg, curly-dimensional-highlights.jpg
Naturally include "${kw}" or a related term only if it fits the visible hair.

ALT TEXT RULES:
80-140 characters ideal.
Must describe ONLY the visible hair and its SEO-relevant properties.
GOOD: "Soft copper balayage with face-framing highlights on medium-length wavy hair"
GOOD: "Dark brunette hair with seamless gray blending using demi-permanent color"
BAD: "A woman with long dark hair wearing a green shirt" (mentions woman, clothing)
BAD: "A woman taking a selfie showing her short hairstyle" (mentions woman, selfie)
Do not keyword stuff. Naturally integrate "${kw}" only if it fits.

You MUST respond exactly in this format:

Filename: [seo-filename].jpg
Alt Text: [SEO alt text]`;

  for (const cred of ordered) {
    try {
      console.log(`[Cloudflare Vision API] Analyzing "${img.originalName}" trying Key #${cred.index} from pool...`);
      const url = `https://api.cloudflare.com/client/v4/accounts/${cred.acc}/ai/run/@cf/llava-hf/llava-1.5-7b-hf`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cred.key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image: imageArray,
          prompt: prompt,
          max_tokens: 256
        }),
        signal: AbortSignal.timeout(18000)
      });

      if (res.status === 200) {
        const data = await res.json();
        if (data.success && data.result && data.result.description) {
          const desc = data.result.description.trim();
          const filenameMatch = desc.match(/Filename:\s*([^\r\n]+)/i);
          const altMatch = desc.match(/Alt\s*Text:\s*([^\r\n]+)/i);
          
          let seoFilename = '';
          let altText = '';
          
          if (filenameMatch) {
            seoFilename = filenameMatch[1].trim();
          }
          if (altMatch) {
            altText = altMatch[1].trim();
          }

          // Fallbacks if parse failed
          if (!seoFilename) {
            const kwSlug = (mainKeyword || 'hair-style').toLowerCase().replace(/[^a-z0-9]+/g, '-');
            seoFilename = `${kwSlug}-image.jpg`;
          }
          if (!altText) {
            altText = `${mainKeyword || 'Hair style'} hair highlights visual check.`;
          }

          // Force .jpg extension
          if (!seoFilename.toLowerCase().endsWith('.jpg') && !seoFilename.toLowerCase().endsWith('.jpeg')) {
            seoFilename = seoFilename.split('.')[0] + '.jpg';
          }

          // Post-process: sanitize AI output to ensure hair-only focus
          const sanitized = sanitizeVisionOutput(seoFilename, altText, mainKeyword || 'Hair Style');
          seoFilename = sanitized.seoFilename;
          altText = sanitized.altText;

          return {
            id: img.id,
            originalName: img.originalName,
            seoFilename,
            altText,
            caption: ''
          };
        }
      }
    } catch (e: any) {
      console.warn(`Cloudflare vision key #${cred.index} error: ${e.message}`);
    }
  }

  throw new Error("All Cloudflare Worker AI vision keys failed");
}

// Gemini Vision API Fallback
async function analyzeImageWithGemini(
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

  // Shuffle keys
  const start = Math.floor(Math.random() * keys.length);
  const orderedKeys = [...keys.slice(start), ...keys.slice(0, start)];

  const mimeType = img.ext === 'png' ? 'image/png' : img.ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const kw = mainKeyword || "Hair Style";
  const promptText = `Analyze this hairstyle image for image SEO. Focus ONLY on the visible hair.

Focus keyword: "${kw}"

Generate:
1. SEO filename: 3-5 words, lowercase, hyphen-separated, describing the hair color/technique/style, ending in .jpg.
   BAD: hair-style.jpg, long-hair-style.jpg, woman-hairstyle.jpg
   GOOD: copper-balayage-face-framing.jpg, gray-blending-demi-permanent.jpg
2. Search-optimized Alt Text: 80-140 characters describing ONLY the hair.
   BAD: "A woman with long dark hair wearing a green shirt" (mentions woman, clothing)
   GOOD: "Soft copper balayage with face-framing highlights on medium-length wavy hair"
3. Short Caption under 60 chars about the hair technique/style.

ABSOLUTE BAN LIST — Do NOT mention any of these:
woman, girl, man, person, model, client, shirt, sweater, blouse, dress, earrings, necklace, hair tie, sitting, standing, selfie, posing, wearing, room, bed, chair, mirror, wall, background, photo, image, picture, face, smile, eyes.

ONLY describe: hair length, texture, color, highlights, lowlights, foils, toner, gloss, cut, layers, curls, regrowth, placement, dimension, gray blending.

You MUST respond strictly in valid JSON format:
{"seoFilename": "...", "altText": "...", "caption": "..."}`;

  for (const apiKey of orderedKeys) {
    try {
      console.log(`[Gemini Vision API] Analyzing "${img.originalName}"...`);
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
          ],
          generationConfig: {
            responseMimeType: "application/json"
          }
        }),
        signal: AbortSignal.timeout(12000)
      });

      if (res.status === 200) {
        const result = await res.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text.trim());
          let seoFilename = parsed.seoFilename || '';
          let altText = parsed.altText || '';
          let caption = parsed.caption || '';

          if (!seoFilename) {
            const kwSlug = (mainKeyword || 'hair-style').toLowerCase().replace(/[^a-z0-9]+/g, '-');
            seoFilename = `${kwSlug}-image.jpg`;
          }
          if (!altText) {
            altText = `${mainKeyword || 'Hair style'} hairstyle view.`;
          }

          if (!seoFilename.toLowerCase().endsWith('.jpg') && !seoFilename.toLowerCase().endsWith('.jpeg')) {
            seoFilename = seoFilename.split('.')[0] + '.jpg';
          }

          // Post-process: sanitize AI output to ensure hair-only focus
          const sanitized = sanitizeVisionOutput(seoFilename, altText, mainKeyword || 'Hair Style');
          seoFilename = sanitized.seoFilename;
          altText = sanitized.altText;

          return {
            id: img.id,
            originalName: img.originalName,
            seoFilename,
            altText,
            caption
          };
        }
      }
    } catch (e: any) {
      console.warn(`Gemini key error: ${e.message}`);
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

    console.log(`[Vision API] Received analysis request for image "${image.originalName}"...`);

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

    // Run Cloudflare Vision LLava or Gemini
    if (visionProvider === 'cloudflare') {
      try {
        const res = await analyzeImageWithCloudflare(imgObj, mainKeyword);
        return NextResponse.json(res);
      } catch (cfErr: any) {
        console.warn(`Cloudflare vision failed on endpoint, falling back to Gemini: ${cfErr.message}`);
      }
    }

    // Fallback to Gemini
    const res = await analyzeImageWithGemini(imgObj, customGeminiKey, mainKeyword);
    return NextResponse.json(res);

  } catch (e: any) {
    console.error("[Vision API Route Error]:", e);
    const kwSlug = (mainKeyword || 'hair-style').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const fallback = {
      id: image?.id || 'img_err',
      originalName: image?.originalName || 'image.jpg',
      seoFilename: `${kwSlug}-example.jpg`,
      altText: `${mainKeyword || 'Hair style'} hair view.`,
      caption: '',
      error: e.message
    };
    return NextResponse.json(fallback);
  }
}
