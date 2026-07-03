import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import fs from 'fs';
import path from 'path';

// Force Next.js to treat this route as dynamic and disable Netlify CDN caching
export const dynamic = 'force-dynamic';

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
          // Disable caching to prevent Netlify CDN/browser caching collision
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
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
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
    }

    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to retrieve image' }, { status: 500 });
  }
}

