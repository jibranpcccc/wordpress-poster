import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import fs from "fs";
import path from "path";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const isTextFile = formData.get("isTextFile") === "true";

    if (files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    const hasFirebase = !!(process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_PROJECT_ID);

    const uploadPromises = files.map(async (file) => {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (isTextFile) {
        return { isText: true, fileName: file.name, content: buffer.toString("utf8") };
      }

      const ext = path.extname(file.name);
      const base = path.basename(file.name, ext).replace(/[^a-zA-Z0-9_\-]/g, "_");
      const uniqueName = `${Date.now()}_${base}${ext}`;
      const mimeType = ext.toLowerCase() === ".png" ? "image/png" : ext.toLowerCase() === ".webp" ? "image/webp" : "image/jpeg";

      // FIREBASE PATH: Save to Firestore for cross-request persistence on serverless
      if (hasFirebase) {
        try {
          const base64Data = buffer.toString("base64");
          await db.saveImage(uniqueName, base64Data, mimeType);
          console.log(`[Upload API] Saved "${file.name}" to Firestore as "${uniqueName}"`);
          return { originalName: file.name, localPath: `/api/image?id=${uniqueName}`, size: file.size };
        } catch (fbErr: any) {
          console.warn(`[Upload API] Firestore save failed for "${file.name}", falling back to disk:`, fbErr.message);
        }
      }

      // LOCAL PATH: Save to disk for local development
      const uploadDir = path.join(process.cwd(), "public", "uploads");
      try {
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(path.join(uploadDir, uniqueName), buffer);
        try { fs.writeFileSync(path.join(uploadDir, file.name), buffer); } catch (e) {}
        console.log(`[Upload API] Saved "${file.name}" to disk at: ${uniqueName}`);
      } catch (err: any) {
        console.error(`[Upload API Error] Failed to write "${file.name}" to disk:`, err.message);
        throw err;
      }

      return { originalName: file.name, localPath: `/uploads/${uniqueName}`, size: file.size };
    });

    const results = await Promise.all(uploadPromises);

    if (isTextFile && results[0] && "isText" in results[0]) {
      return NextResponse.json({ success: true, fileName: (results[0] as any).fileName, content: (results[0] as any).content });
    }

    return NextResponse.json({ success: true, files: results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to upload files" }, { status: 500 });
  }
}
