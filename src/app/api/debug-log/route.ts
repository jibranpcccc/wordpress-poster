import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const logPath = path.join(process.cwd(), 'public', 'api-debug.log');
    if (!fs.existsSync(logPath)) {
      return new Response("No logs found. Run an AI analysis to generate logs.", {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
    const content = fs.readFileSync(logPath, 'utf-8');
    return new Response(content, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  } catch (err: any) {
    return new Response(`Error reading logs: ${err.message}`, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const logPath = path.join(process.cwd(), 'public', 'api-debug.log');
    if (fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, ''); // Clear it
    }
    return NextResponse.json({ success: true, message: "Debug log cleared successfully." });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
