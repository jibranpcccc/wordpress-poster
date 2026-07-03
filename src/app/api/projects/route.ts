import { NextResponse } from 'next/server';
import { db, Project } from '@/lib/db';
import fs from 'fs';
import path from 'path';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      const project = await db.getProject(id);
      if (!project) {
        return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      }
      return NextResponse.json(project);
    }

    const projects = await db.getProjects();
    return NextResponse.json(projects);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to get projects' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const project: Project = await request.json();
    if (!project.id) {
      return NextResponse.json({ error: 'Missing project ID' }, { status: 400 });
    }

    await db.saveProject(project);
    return NextResponse.json({ success: true, project });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to save project' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing project ID' }, { status: 400 });
    }

    // Load the project to delete its associated images
    try {
      const project = await db.getProject(id);
      if (project && project.images) {
        for (const img of project.images) {
          // 1. Firebase Firestore image cleanup
          if (img.localPath && img.localPath.includes('?id=')) {
            try {
              const urlObj = new URL(img.localPath, 'http://localhost');
              const imageId = urlObj.searchParams.get('id');
              if (imageId) {
                await db.deleteImage(imageId);
                console.log(`[Project DELETE] Cleaned up Firebase image asset: ${imageId}`);
              }
            } catch (err: any) {
              console.warn(`[Project DELETE Warning] Failed to delete image asset from Firebase:`, err.message);
            }
          }
          // 2. Local uploads folder disk cleanup (for local dev environments)
          else if (img.localPath && img.localPath.startsWith('/uploads/')) {
            try {
              const filename = img.localPath.split('/').pop()?.split('?')[0];
              if (filename) {
                const filePath = path.join(process.cwd(), 'public', 'uploads', filename);
                if (fs.existsSync(filePath)) {
                  fs.unlinkSync(filePath);
                  console.log(`[Project DELETE] Cleaned up local disk image: ${filePath}`);
                }
              }
            } catch (err: any) {
              console.warn(`[Project DELETE Warning] Failed to delete local image file from disk:`, err.message);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Project DELETE Warning] Error fetching project for image cleanup:`, err.message);
    }

    const deleted = await db.deleteProject(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to delete project' }, { status: 500 });
  }
}
