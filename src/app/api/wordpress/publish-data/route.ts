import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';

/**
 * GET /api/wordpress/publish-data?projectId=xxx
 * 
 * Returns all project data + image base64 blobs needed for
 * CLIENT-SIDE WordPress publishing. The browser then makes
 * WordPress API calls directly (from the user's own IP),
 * completely bypassing any server-level IP blocks.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');

  if (!projectId) {
    return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
  }

  try {
    const project = await db.getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const uploadDir = path.join(process.cwd(), 'public');

    // Enrich each image with its base64 data so the browser can upload directly
    const imagesWithData = await Promise.all(
      project.images.map(async (img) => {
        if (img.doNotUse) return { ...img, base64Data: null, mimeType: null };
        if (img.wpMediaId) return { ...img, base64Data: null, mimeType: null }; // already uploaded

        let base64Data: string | null = null;
        let mimeType = 'image/jpeg';

        // Load from Firestore
        if (img.localPath.includes('?id=')) {
          try {
            const urlObj = new URL(img.localPath, 'http://localhost');
            const imageId = urlObj.searchParams.get('id');
            if (imageId) {
              const imgAsset = await db.getImage(imageId);
              if (imgAsset) {
                base64Data = imgAsset.base64Data;
                const ext = path.extname(imageId).replace('.', '').toLowerCase();
                mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
              }
            }
          } catch (e) {}
        }

        // Fallback: local files
        if (!base64Data) {
          let checkPath = img.localPath;
          if (checkPath.includes('?id=')) {
            try {
              const urlObj = new URL(checkPath, 'http://localhost');
              const imageId = urlObj.searchParams.get('id');
              if (imageId) checkPath = `/uploads/${imageId}`;
            } catch (e) {}
          }
          const fullPath = path.join(uploadDir, checkPath.replace(/^\//, ''));
          if (fs.existsSync(fullPath)) {
            const buf = fs.readFileSync(fullPath);
            base64Data = buf.toString('base64');
            const ext = path.extname(checkPath).replace('.', '').toLowerCase();
            mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
          }
        }

        return { ...img, base64Data, mimeType };
      })
    );

    return NextResponse.json({
      project: { ...project, images: imagesWithData }
    });

  } catch (e: any) {
    console.error('publish-data error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * DELETE /api/wordpress/publish-data?projectId=xxx
 * Called by browser after successful client-side publish to clean up Firestore
 */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  if (!projectId) return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });

  try {
    const project = await db.getProject(projectId);
    if (project) {
      // Delete all Firestore image assets
      for (const img of project.images) {
        if (img.localPath && img.localPath.includes('?id=')) {
          try {
            const urlObj = new URL(img.localPath, 'http://localhost');
            const imageId = urlObj.searchParams.get('id');
            if (imageId) await db.deleteImage(imageId);
          } catch (e) {}
        }
      }
      await db.deleteProject(projectId);
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
