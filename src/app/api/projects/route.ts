import { NextResponse } from 'next/server';
import { db, Project } from '@/lib/db';

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

    const deleted = await db.deleteProject(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to delete project' }, { status: 500 });
  }
}
