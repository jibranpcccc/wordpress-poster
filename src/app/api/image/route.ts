import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import fs from 'fs';
import path from 'path';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing image ID' }, { status: 400 });
    }

    // 1. Try to load from database (Firestore)
    const imgAsset = await db.getImage(id);
    if (imgAsset) {
      const buffer = Buffer.from(imgAsset.base64Data, 'base64');
      return new Response(buffer, {
        headers: {
          'Content-Type': imgAsset.contentType || 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }

    // 2. Fall back to local filesystem
    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    const filePath = path.join(uploadDir, id);
    if (fs.existsSync(filePath)) {
      const fileBuffer = fs.readFileSync(filePath);
      const ext = path.extname(id).replace('.', '').toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return new Response(fileBuffer, {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }

    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to retrieve image' }, { status: 500 });
  }
}
