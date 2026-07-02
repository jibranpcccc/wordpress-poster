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

    const wpUrl = formData.get('wpUrl') as string;
    const wpUser = formData.get('wpUser') as string;
    const wpPassword = formData.get('wpPassword') as string;
    const hasFirebase = !!(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_PROJECT_ID);

    // Process all files concurrently in parallel for maximum speed
    const uploadPromises = files.map(async (file) => {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (isTextFile) {
        const textContent = buffer.toString('utf8');
        return {
          isText: true,
          fileName: file.name,
          content: textContent
        };
      }

      // Cache copy locally in public/uploads so that it can be loaded locally during analyze API
      try {
        const uploadDir = path.join(process.cwd(), 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const filePath = path.join(uploadDir, file.name);
        fs.writeFileSync(filePath, buffer);
        console.log(`[Upload API] Cached local copy of "${file.name}" at ${filePath}`);
      } catch (cacheErr: any) {
        console.warn(`[Upload API Warning] Failed to write local cache copy of "${file.name}":`, cacheErr.message);
      }

      // Save image locally to flat-file on disk (since we are running locally)
      const ext = path.extname(file.name);
      const base = path.basename(file.name, ext).replace(/[^a-zA-Z0-9_\-]/g, '_');
      const uniqueName = `${Date.now()}_${base}${ext}`;
      const uploadDir = path.join(process.cwd(), 'public', 'uploads');
      
      try {
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const filePath = path.join(uploadDir, uniqueName);
        fs.writeFileSync(filePath, buffer);
        console.log(`[Upload API] Saved local image file at: ${filePath}`);
      } catch (err: any) {
        console.error(`[Upload API Error] Failed to write local copy for "${file.name}":`, err.message);
        throw err;
      }

      // Also cache it under originalName so visual analysis can find it easily
      try {
        const cachedPath = path.join(uploadDir, file.name);
        fs.writeFileSync(cachedPath, buffer);
      } catch (e) {}

      return {
        originalName: file.name,
        localPath: `/uploads/${uniqueName}`,
        size: file.size
      };
    });

    const results = await Promise.all(uploadPromises);

    // If it was a text file, return it
    if (isTextFile && results[0] && 'isText' in results[0]) {
      return NextResponse.json({
        success: true,
        fileName: (results[0] as any).fileName,
        content: (results[0] as any).content
      });
    }

    return NextResponse.json({ success: true, files: results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to upload files' }, { status: 500 });
  }
}
