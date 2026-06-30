import { NextResponse } from 'next/server';
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

    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
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

      // Safe filename generation: keep extensions, replace special characters
      const ext = path.extname(file.name);
      const base = path.basename(file.name, ext).replace(/[^a-zA-Z0-9_\-]/g, '_');
      const uniqueName = `${Date.now()}_${base}${ext}`;
      const filePath = path.join(uploadDir, uniqueName);

      fs.writeFileSync(filePath, buffer);

      results.push({
        originalName: file.name,
        localPath: `/uploads/${uniqueName}`,
        size: file.size
      });
    }

    return NextResponse.json({ success: true, files: results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to upload files' }, { status: 500 });
  }
}
