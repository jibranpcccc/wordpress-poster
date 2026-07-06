import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { db, Project, ImageDetail } from '@/lib/db';

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
    body: fileBuffer as any
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`WordPress Media Upload failed: ${uploadRes.statusText} (${errText})`);
  }

  const media = await uploadRes.json();
  const mediaId = media.id;
  const sourceUrl = media.source_url;

  console.log(`[WP Media] Image uploaded successfully. ID: ${mediaId}. Updating SEO metadata...`);

  // 2. Update media detail with Alt Text, Caption, and Title in WP Media Library
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
    })
  });

  if (!updateRes.ok) {
    console.warn(`[WP Media Warning] Failed to update SEO meta for media ID ${mediaId}: ${updateRes.statusText}`);
  } else {
    console.log(`[WP Media] SEO metadata updated successfully for ID ${mediaId}`);
  }

  return { id: mediaId, url: sourceUrl };
}

async function resolveTagIds(tagsStr: string, wpUrl: string, authHeader: string): Promise<number[]> {
  if (!tagsStr) return [];
  const tagNames = tagsStr.split(',').map(t => t.trim()).filter(t => t.length > 0);
  const tagIds: number[] = [];

  for (const name of tagNames) {
    try {
      // 1. Search if tag already exists
      const searchRes = await fetch(`${wpUrl}/wp-json/wp/v2/tags?search=${encodeURIComponent(name)}`, {
        headers: { 'Authorization': authHeader },
        signal: AbortSignal.timeout(6000)
      });
      if (searchRes.ok) {
        const existingTags = await searchRes.json();
        const exactMatch = Array.isArray(existingTags) && existingTags.find(t => t.name.toLowerCase() === name.toLowerCase());
        if (exactMatch) {
          tagIds.push(exactMatch.id);
          continue;
        }
      }

      // 2. Create the tag if not found
      console.log(`[WP Tags] Creating tag "${name}" on WordPress site...`);
      const createRes = await fetch(`${wpUrl}/wp-json/wp/v2/tags`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: name }),
        signal: AbortSignal.timeout(6000)
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
      const sendProgress = (message: string) => {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'progress', message }) + '\n'));
      };

      try {
        sendProgress("Loading project details from database...");
        const project = await db.getProject(projectId);
        if (!project) {
          throw new Error('Project not found');
        }

        const cleanWpUrl = wpUrl.replace(/\/$/, "");
        const authHeader = `Basic ${Buffer.from(`${wpUser}:${wpPassword}`).toString('base64')}`;

        // 2. Identify active images and copy path references
        const activeImages = project.images.filter(img => !img.doNotUse);
        const featuredImage = activeImages.find(img => img.isFeatured);

        const uploadDir = path.join(process.cwd(), 'public');
        const wpImageMap: { [localId: string]: { id: number; url: string } } = {};

        // 3. Upload all active images to WP Media library in chunks of 4
        const uploadSingleImage = async (img: ImageDetail, idx: number, total: number) => {
          try {
            if (img.wpMediaId) {
              sendProgress(`Updating pre-uploaded image ${idx + 1}/${total} ("${img.originalName}")...`);
              // Update media detail with Alt Text, Caption, and Title in WP Media Library
              const updateRes = await fetch(`${cleanWpUrl}/wp-json/wp/v2/media/${img.wpMediaId}`, {
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
                })
              });

              let liveUrl = img.localPath;
              if (!updateRes.ok) {
                console.warn(`[WP Media Warning] Failed to update SEO meta for pre-uploaded media ID ${img.wpMediaId}: ${updateRes.statusText}`);
                try {
                  const getRes = await fetch(`${cleanWpUrl}/wp-json/wp/v2/media/${img.wpMediaId}`, {
                    headers: { 'Authorization': authHeader }
                  });
                  if (getRes.ok) {
                    const mediaData = await getRes.json();
                    liveUrl = mediaData.source_url || img.localPath;
                  }
                } catch (e) {}
              } else {
                console.log(`[WP Media] SEO metadata updated successfully for pre-uploaded ID ${img.wpMediaId}`);
                try {
                  const mediaData = await updateRes.json();
                  liveUrl = mediaData.source_url || img.localPath;
                } catch (e) {}
              }

              return { localId: img.id, wpMedia: { id: img.wpMediaId, url: liveUrl } };
            }

            let fileBuffer: Buffer | null = null;
            let ext = 'jpg';

            // Check if it's a Firestore image URL (contains ?id=)
            if (img.localPath.includes('?id=')) {
              const urlObj = new URL(img.localPath, 'http://localhost');
              const imageId = urlObj.searchParams.get('id');
              if (imageId) {
                const imgAsset = await db.getImage(imageId);
                if (imgAsset) {
                  fileBuffer = Buffer.from(imgAsset.base64Data, 'base64');
                  ext = path.extname(imageId).replace('.', '').toLowerCase();
                  console.log(`[WP Media] Loaded image "${img.originalName}" (${imageId}) from Firestore.`);
                }
              }
            }

            // Fallback to local files
            if (!fileBuffer) {
              let checkPath = img.localPath;
              if (checkPath.includes('?id=')) {
                try {
                  const urlObj = new URL(checkPath, 'http://localhost');
                  const imageId = urlObj.searchParams.get('id');
                  if (imageId) {
                    checkPath = `/uploads/${imageId}`;
                  }
                } catch (e) {}
              }
              const fullPath = path.join(uploadDir, checkPath.replace(/^\//, ''));
              if (fs.existsSync(fullPath)) {
                fileBuffer = fs.readFileSync(fullPath);
                ext = path.extname(checkPath).replace('.', '').toLowerCase();
                console.log(`[WP Media] Loaded image "${img.originalName}" from local filesystem fallback.`);
              } else {
                console.warn(`Image file not found locally or in Firestore at: ${img.localPath}`);
              }
            }

            if (fileBuffer) {
              sendProgress(`Uploading image ${idx + 1}/${total} ("${img.originalName}")...`);
              const wpMedia = await uploadAndSetImageSEO(fileBuffer, ext, img, cleanWpUrl, authHeader);
              return { localId: img.id, wpMedia };
            } else {
              throw new Error("No image buffer found");
            }
          } catch (mediaErr: any) {
            console.error(`Failed uploading image ${img.originalName} to WordPress:`, mediaErr);
            sendProgress(`Warning: Failed to upload image "${img.originalName}": ${mediaErr.message || mediaErr}`);
            return null;
          }
        };

        const uploadResults: any[] = [];
        const wpChunkSize = 10;
        for (let i = 0; i < activeImages.length; i += wpChunkSize) {
          const chunk = activeImages.slice(i, i + wpChunkSize);
          const chunkPromises = chunk.map((img, cIdx) => uploadSingleImage(img, i + cIdx, activeImages.length));
          const chunkRes = await Promise.all(chunkPromises);
          uploadResults.push(...chunkRes);
        }
        
        uploadResults.forEach(res => {
          if (res) {
            wpImageMap[res.localId] = res.wpMedia;
          }
        });

        // 4. Determine featured media ID
        let wpFeaturedMediaId = 0;
        if (featuredImage && wpImageMap[featuredImage.id]) {
          wpFeaturedMediaId = wpImageMap[featuredImage.id].id;
        }

        const stripImagePlaceholders = (text: string): string => {
          const lines = text.split('\n');
          const filtered = lines.filter(line => {
            const cleanLine = line.trim().replace(/^[\*\s_\x22\x27\u201C\u201D\[]+/, '').toLowerCase();
            if (cleanLine.startsWith('image:') || cleanLine.startsWith('image]') || cleanLine.startsWith('[image:')) {
              return false;
            }
            if (cleanLine.startsWith('alt text:') || cleanLine.startsWith('alt tag:') || cleanLine.startsWith('alttag:')) {
              return false;
            }
            if (cleanLine.startsWith('caption:')) {
              return false;
            }
            if (cleanLine.startsWith('filename:') || cleanLine.startsWith('seo filename:')) {
              return false;
            }
            const trimmedRaw = line.trim();
            if (trimmedRaw === '*' || trimmedRaw === '**' || trimmedRaw === '_' || trimmedRaw === '__') {
              return false;
            }
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
          const words = trimmed.split(/\s+/);
          if (words.length > 12) return false;
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

        // 5.5 Resolve tags
        sendProgress("Resolving WordPress tags...");
        const tagIds = await resolveTagIds(project.tags || '', cleanWpUrl, authHeader);

        // 6. Post final payload
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
          body: JSON.stringify(postPayload)
        });

        if (!postRes.ok) {
          const errData = await postRes.json().catch(() => ({}));
          throw new Error(`WordPress Post publication failed: ${errData.message || postRes.statusText}`);
        }

        const livePost = await postRes.json();
        
        // Clean up Firestore data
        sendProgress("Cleaning up project temporary data...");
        try {
          await db.deleteProject(projectId);
          if (project.images && project.images.length > 0) {
            for (const img of project.images) {
              if (img.localPath && img.localPath.includes('?id=')) {
                try {
                  const urlObj = new URL(img.localPath, 'http://localhost');
                  const imageId = urlObj.searchParams.get('id');
                  if (imageId) {
                    await db.deleteImage(imageId);
                  }
                } catch (pErr) {}
              }
            }
          }
        } catch (cleanErr) {}

        sendProgress("Publish completed successfully!");
        controller.enqueue(encoder.encode(JSON.stringify({
          type: 'success',
          data: {
            success: true,
            link: livePost.link,
            id: livePost.id
          }
        }) + '\n'));

      } catch (e: any) {
        console.error("WordPress publish error:", e);
        controller.enqueue(encoder.encode(JSON.stringify({
          type: 'error',
          error: e.message || 'Failed to publish post to WordPress'
        }) + '\n'));
      } finally {
        controller.close();
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

