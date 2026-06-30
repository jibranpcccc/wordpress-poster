import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import fs from 'fs';
import path from 'path';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const isTextFile = formData.get('isTextFile') === 'true';

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files uploaded' }, { status: 400 });
    }

    const results = [];

    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (isTextFile) {
        // If it's a text/markdown file, read its text content and return it
        const textContent = buffer.toString('utf8');
        return NextResponse.json({
          success: true,
          fileName: file.name,
          content: textContent
        });
      }

      // Check file size to fit Firestore's 1MB document limit
      const hasFirebase = !!(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_PROJECT_ID);
      if (hasFirebase && file.size > 900 * 1024) {
        return NextResponse.json({
          error: `Image "${file.name}" is too large (${(file.size / 1024).toFixed(0)}KB). For cloud storage and optimal SEO speed, please compress your images to under 900KB before uploading.`
        }, { status: 400 });
      }

      // Safe filename generation: keep extensions, replace special characters
      const ext = path.extname(file.name);
      const base = path.basename(file.name, ext).replace(/[^a-zA-Z0-9_\-]/g, '_');
      const uniqueName = `${Date.now()}_${base}${ext}`;
      const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const base64Data = buffer.toString('base64');

      let savedInDb = false;
      if (hasFirebase) {
        try {
          await db.saveImage(uniqueName, base64Data, mimeType);
          savedInDb = true;
          console.log(`[Upload] Image "${uniqueName}" successfully saved to Firestore.`);
        } catch (dbErr: any) {
          console.warn("[Upload] Failed to save image to Firestore, falling back to local files:", dbErr);
        }
      }

      if (!savedInDb) {
        const uploadDir = path.join(process.cwd(), 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const filePath = path.join(uploadDir, uniqueName);
        fs.writeFileSync(filePath, buffer);
        console.log(`[Upload] Image "${uniqueName}" saved locally to flat-file.`);
      }

      results.push({
        originalName: file.name,
        localPath: savedInDb ? `/api/image?id=${uniqueName}` : `/uploads/${uniqueName}`,
        size: file.size
      });
    }

    return NextResponse.json({ success: true, files: results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to upload files' }, { status: 500 });
  }
}
