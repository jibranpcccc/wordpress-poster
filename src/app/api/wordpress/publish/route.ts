import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { db, Project, ImageDetail } from '@/lib/db';

// Per-fetch timeout: each individual WordPress API call gets 8 seconds max
const FETCH_TIMEOUT_MS = 8000;
// Number of images to upload simultaneously (3 keeps WordPress happy and finishes fast)
const PARALLEL_UPLOAD_SIZE = 3;

async function uploadAndSetImageSEO(
  fileBuffer: Buffer,
  ext: string,
  img: ImageDetail,
  wpUrl: string,
  authHeader: string
): Promise<{ id: number; url: string }> {
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

  console.log(`[WP Media] Uploading binary for image: "${img.originalName}" to ${wpUrl}...`);
  
  // 1. Upload raw binary
  const uploadRes = await fetch(`${wpUrl}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Disposition': `attachment; filename="${img.seoFilename}"`,
      'Content-Type': mimeType
    },
    body: fileBuffer as any,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`WordPress Media Upload failed: ${uploadRes.statusText} (${errText})`);
  }

  const media = await uploadRes.json();
  const mediaId = media.id;
  const sourceUrl = media.source_url;

  console.log(`[WP Media] Image uploaded. ID: ${mediaId}. Updating SEO metadata...`);

  // 2. Update SEO metadata (fire-and-forget style: don't wait too long)
  try {
    const updateRes = await fetch(`${wpUrl}/wp-json/wp/v2/media/${mediaId}`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        alt_text: img.altText || '',
        caption: img.caption || '',
        title: img.seoFilename.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "),
        description: img.notes || ''
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!updateRes.ok) {
      console.warn(`[WP Media Warning] Failed to update SEO meta for media ID ${mediaId}: ${updateRes.statusText}`);
    }
  } catch (e) {
    console.warn(`[WP Media Warning] SEO meta update timed out for ID ${mediaId}, continuing...`);
  }

  return { id: mediaId, url: sourceUrl };
}

async function resolveTagIds(tagsStr: string, wpUrl: string, authHeader: string): Promise<number[]> {
  if (!tagsStr) return [];
  const tagNames = tagsStr.split(',').map(t => t.trim()).filter(t => t.length > 0);
  const tagIds: number[] = [];

  for (const name of tagNames) {
    try {
      const searchRes = await fetch(`${wpUrl}/wp-json/wp/v2/tags?search=${encodeURIComponent(name)}`, {
        headers: { 'Authorization': authHeader },
        signal: AbortSignal.timeout(5000)
      });
      if (searchRes.ok) {
        const existingTags = await searchRes.json();
        const exactMatch = Array.isArray(existingTags) && existingTags.find(t => t.name.toLowerCase() === name.toLowerCase());
        if (exactMatch) {
          tagIds.push(exactMatch.id);
          continue;
        }
      }

      const createRes = await fetch(`${wpUrl}/wp-json/wp/v2/tags`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: name }),
        signal: AbortSignal.timeout(5000)
      });
      if (createRes.ok) {
        const newTag = await createRes.json();
        tagIds.push(newTag.id);
      } else {
        const errText = await createRes.text();
        console.warn(`[WP Tags Warning] Failed to create tag "${name}": ${errText}`);
      }
    } catch (err: any) {
      console.warn(`[WP Tags Warning] Error resolving tag "${name}":`, err.message);
    }
  }
  return tagIds;
}

export async function POST(request: Request) {
  const encoder = new TextEncoder();

  let requestBody: any;
  try {
    requestBody = await request.json();
  } catch (err) {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  const { projectId, wpUrl, wpUser, wpPassword, status } = requestBody;

  if (!projectId || !wpUrl || !wpUser || !wpPassword) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      let controllerClosed = false;

      const sendChunk = (data: object) => {
        if (controllerClosed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
        } catch (e) {}
      };

      const sendProgress = (message: string) => sendChunk({ type: 'progress', message });

      // Keepalive: send a ping every 2 seconds so Netlify/proxy keeps the connection alive
      const keepaliveInterval = setInterval(() => sendChunk({ type: 'ping' }), 2000);

      const cleanup = () => {
        clearInterval(keepaliveInterval);
        if (!controllerClosed) {
          controllerClosed = true;
          try { controller.close(); } catch (e) {}
        }
      };

      try {
        sendProgress("Loading project details from database...");
        const project = await db.getProject(projectId);
        if (!project) {
          throw new Error('Project not found');
        }

        const cleanWpUrl = wpUrl.replace(/\/$/, "");
        const authHeader = `Basic ${Buffer.from(`${wpUser}:${wpPassword}`).toString('base64')}`;

        const activeImages = project.images.filter(img => !img.doNotUse);
        const featuredImage = activeImages.find(img => img.isFeatured);
        const uploadDir = path.join(process.cwd(), 'public');
        const wpImageMap: { [localId: string]: { id: number; url: string } } = {};

        sendProgress(`Uploading ${activeImages.length} image(s) to WordPress...`);

        // Helper: resolve image buffer from Firestore or local filesystem
        const loadImageBuffer = async (img: ImageDetail): Promise<{ buffer: Buffer; ext: string } | null> => {
          let fileBuffer: Buffer | null = null;
          let ext = 'jpg';

          if (img.localPath.includes('?id=')) {
            try {
              const urlObj = new URL(img.localPath, 'http://localhost');
              const imageId = urlObj.searchParams.get('id');
              if (imageId) {
                const imgAsset = await db.getImage(imageId);
                if (imgAsset) {
                  fileBuffer = Buffer.from(imgAsset.base64Data, 'base64');
                  ext = path.extname(imageId).replace('.', '').toLowerCase() || 'jpg';
                }
              }
            } catch (e) {}
          }

          if (!fileBuffer) {
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
              fileBuffer = fs.readFileSync(fullPath);
              ext = path.extname(checkPath).replace('.', '').toLowerCase() || 'jpg';
            }
          }

          return fileBuffer ? { buffer: fileBuffer, ext } : null;
        };

        // Upload all images in parallel batches of PARALLEL_UPLOAD_SIZE
        // 3 parallel × ~2s per image = batches finish in ~2s each
        // 10 images = 4 batches = ~8s total — well within 26s Netlify limit
        for (let i = 0; i < activeImages.length; i += PARALLEL_UPLOAD_SIZE) {
          const batch = activeImages.slice(i, i + PARALLEL_UPLOAD_SIZE);
          const batchNum = Math.floor(i / PARALLEL_UPLOAD_SIZE) + 1;
          const totalBatches = Math.ceil(activeImages.length / PARALLEL_UPLOAD_SIZE);
          sendProgress(`Uploading images batch ${batchNum}/${totalBatches} (${batch.length} image${batch.length > 1 ? 's' : ''})...`);

          const batchResults = await Promise.all(
            batch.map(async (img, bIdx) => {
              const globalIdx = i + bIdx;
              try {
                // Handle pre-uploaded images
                if (img.wpMediaId) {
                  try {
                    const updateRes = await fetch(`${cleanWpUrl}/wp-json/wp/v2/media/${img.wpMediaId}`, {
                      method: 'POST',
                      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        alt_text: img.altText || '',
                        caption: img.caption || '',
                        title: img.seoFilename.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "),
                        description: img.notes || ''
                      }),
                      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
                    });
                    let liveUrl = img.localPath;
                    if (updateRes.ok) {
                      try { const d = await updateRes.json(); liveUrl = d.source_url || img.localPath; } catch (e) {}
                    }
                    return { localId: img.id, wpMedia: { id: img.wpMediaId, url: liveUrl } };
                  } catch (e: any) {
                    console.warn(`Pre-uploaded image ${img.wpMediaId} update failed: ${e.message}`);
                    return { localId: img.id, wpMedia: { id: img.wpMediaId, url: img.localPath } };
                  }
                }

                // Load image buffer
                const loaded = await loadImageBuffer(img);
                if (!loaded) {
                  console.warn(`[WP Media] No buffer for "${img.originalName}" — skipping.`);
                  return null;
                }

                const wpMedia = await uploadAndSetImageSEO(loaded.buffer, loaded.ext, img, cleanWpUrl, authHeader);
                return { localId: img.id, wpMedia };
              } catch (mediaErr: any) {
                console.error(`Failed uploading image ${img.originalName}:`, mediaErr.message);
                sendProgress(`Warning: Could not upload "${img.originalName}" — skipping.`);
                return null;
              }
            })
          );

          // Merge results into wpImageMap
          for (const res of batchResults) {
            if (res) wpImageMap[res.localId] = res.wpMedia;
          }
        }

        // Determine featured media ID
        let wpFeaturedMediaId = 0;
        if (featuredImage && wpImageMap[featuredImage.id]) {
          wpFeaturedMediaId = wpImageMap[featuredImage.id].id;
        }

        const stripImagePlaceholders = (text: string): string => {
          const lines = text.split('\n');
          const filtered = lines.filter(line => {
            const cleanLine = line.trim().replace(/^[\*\s_\x22\x27\u201C\u201D\[]+/, '').toLowerCase();
            if (cleanLine.startsWith('image:') || cleanLine.startsWith('image]') || cleanLine.startsWith('[image:')) return false;
            if (cleanLine.startsWith('alt text:') || cleanLine.startsWith('alt tag:') || cleanLine.startsWith('alttag:')) return false;
            if (cleanLine.startsWith('caption:')) return false;
            if (cleanLine.startsWith('filename:') || cleanLine.startsWith('seo filename:')) return false;
            const trimmedRaw = line.trim();
            if (trimmedRaw === '*' || trimmedRaw === '**' || trimmedRaw === '_' || trimmedRaw === '__') return false;
            return true;
          });
          return filtered.join('\n');
        };

        let articleText = stripImagePlaceholders(project.formattedContent || project.articleContent);

        const paragraphs = articleText
          .split('\n')
          .map(p => p.trim())
          .filter(p => p.length > 0);

        const markdownToHtml = (text: string) => {
          return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
        };

        const isHeading = (text: string): boolean => {
          const trimmed = text.trim();
          if (trimmed.length === 0 || trimmed.length > 85) return false;
          if (trimmed.startsWith('#')) return true;
          if (/[.\?!]$/.test(trimmed)) return false;
          if (trimmed.includes('<') && trimmed.includes('>')) return false;
          if (!/^[A-Z0-9\x22\x27\u201C\u201D]/.test(trimmed)) return false;
          if (trimmed.split(/\s+/).length > 12) return false;
          return true;
        };

        let htmlContent = '';
        paragraphs.forEach((p, idx) => {
          const trimmedP = p.trim();
          
          if (trimmedP.startsWith('<!-- wp:') || trimmedP.startsWith('<!-- /wp:') || trimmedP.startsWith('<figure') || trimmedP.startsWith('</figure>') || trimmedP.startsWith('<img') || trimmedP.startsWith('<figcaption')) {
            htmlContent += trimmedP + '\n';
          } else if (trimmedP.startsWith('###') || (isHeading(trimmedP) && trimmedP.startsWith('#') && trimmedP.split('#').length - 1 === 3)) {
            const cleanText = trimmedP.replace(/^###\s*/, '').replace(/^#+\s*/, '');
            htmlContent += `<!-- wp:heading {"level":3} -->\n<h3>${markdownToHtml(cleanText)}</h3>\n<!-- /wp:heading -->\n\n`;
          } else if (trimmedP.startsWith('##') || trimmedP.startsWith('#') || isHeading(trimmedP)) {
            const cleanText = trimmedP.replace(/^##\s*/, '').replace(/^#+\s*/, '');
            htmlContent += `<!-- wp:heading -->\n<h2>${markdownToHtml(cleanText)}</h2>\n<!-- /wp:heading -->\n\n`;
          } else {
            htmlContent += `<!-- wp:paragraph -->\n<p>${markdownToHtml(trimmedP)}</p>\n<!-- /wp:paragraph -->\n\n`;
          }

          const matchedImgs = activeImages.filter(img => img.placement === `after paragraph ${idx}`);
          matchedImgs.forEach(img => {
            const wpMedia = wpImageMap[img.id];
            const cleanTitle = img.seoFilename.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
            if (wpMedia) {
              htmlContent += `<!-- wp:image {"id":${wpMedia.id},"sizeSlug":"large","linkDestination":"none"} -->\n<figure class="wp-block-image size-large"><img src="${wpMedia.url}" alt="${img.altText || ''}" class="wp-image-${wpMedia.id}" title="${cleanTitle}"/>${img.caption ? `<figcaption class="wp-element-caption">${img.caption}</figcaption>` : ''}</figure>\n<!-- /wp:image -->\n\n`;
            } else {
              htmlContent += `<!-- wp:image -->\n<figure class="wp-block-image size-large"><img src="${img.localPath}" alt="${img.altText || ''}" title="${cleanTitle}"/>${img.caption ? `<figcaption class="wp-element-caption">${img.caption}</figcaption>` : ''}</figure>\n<!-- /wp:image -->\n\n`;
            }
          });
        });

        // Resolve tags
        sendProgress("Resolving WordPress tags...");
        const tagIds = await resolveTagIds(project.tags || '', cleanWpUrl, authHeader);

        // Create the post
        sendProgress("Creating WordPress post entry...");
        
        const postPayload: Record<string, any> = {
          title: project.seoData?.seoTitle || project.title,
          content: htmlContent,
          excerpt: project.seoData?.metaDescription || '',
          status: status || 'draft',
          slug: project.seoData?.slug || '',
          categories: project.selectedCategoryIds || [],
          tags: tagIds,
          featured_media: wpFeaturedMediaId > 0 ? wpFeaturedMediaId : undefined,
          meta: {
            _yoast_wpseo_title: project.seoData?.seoTitle || project.title,
            _yoast_wpseo_focuskw: project.seoData?.focusKeyword || '',
            _yoast_wpseo_metadesc: project.seoData?.metaDescription || '',
            rank_math_title: project.seoData?.seoTitle || project.title,
            rank_math_description: project.seoData?.metaDescription || '',
            rank_math_focus_keyword: project.seoData?.focusKeyword || ''
          }
        };

        const postRes = await fetch(`${cleanWpUrl}/wp-json/wp/v2/posts`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(postPayload),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });

        if (!postRes.ok) {
          const errData = await postRes.json().catch(() => ({}));
          throw new Error(`WordPress Post publication failed: ${errData.message || postRes.statusText}`);
        }

        const livePost = await postRes.json();
        
        // Clean up Firestore data (non-blocking)
        sendProgress("Cleaning up project temporary data...");
        try {
          await db.deleteProject(projectId);
          for (const img of project.images) {
            if (img.localPath && img.localPath.includes('?id=')) {
              try {
                const urlObj = new URL(img.localPath, 'http://localhost');
                const imageId = urlObj.searchParams.get('id');
                if (imageId) await db.deleteImage(imageId);
              } catch (pErr) {}
            }
          }
        } catch (cleanErr) {}

        sendProgress("Publish completed successfully!");
        sendChunk({
          type: 'success',
          data: {
            success: true,
            link: livePost.link,
            id: livePost.id
          }
        });

      } catch (e: any) {
        console.error("WordPress publish error:", e);
        sendChunk({
          type: 'error',
          error: e.message || 'Failed to publish post to WordPress'
        });
      } finally {
        cleanup();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
