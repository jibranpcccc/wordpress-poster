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

export async function POST(request: Request) {
  try {
    const { projectId, wpUrl, wpUser, wpPassword, status } = await request.json();

    if (!projectId || !wpUrl || !wpUser || !wpPassword) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // 1. Load project details from db
    const project = await db.getProject(projectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const cleanWpUrl = wpUrl.replace(/\/$/, "");
    const authHeader = `Basic ${Buffer.from(`${wpUser}:${wpPassword}`).toString('base64')}`;

    // 2. Identify active images and copy path references
    const activeImages = project.images.filter(img => !img.doNotUse);
    const featuredImage = activeImages.find(img => img.isFeatured);

    const uploadDir = path.join(process.cwd(), 'public');
    const wpImageMap: { [localId: string]: { id: number; url: string } } = {};

    // 3. Upload all active images to WP Media library
    for (const img of activeImages) {
      try {
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
          const fullPath = path.join(uploadDir, img.localPath);
          if (fs.existsSync(fullPath)) {
            fileBuffer = fs.readFileSync(fullPath);
            ext = path.extname(img.localPath).replace('.', '').toLowerCase();
            console.log(`[WP Media] Loaded image "${img.originalName}" from local filesystem.`);
          } else {
            console.warn(`Image file not found locally or in Firestore at: ${img.localPath}`);
          }
        }

        if (fileBuffer) {
          const wpMedia = await uploadAndSetImageSEO(fileBuffer, ext, img, cleanWpUrl, authHeader);
          wpImageMap[img.id] = wpMedia;
        } else {
          throw new Error("No image buffer found");
        }
      } catch (mediaErr: any) {
        console.error(`Failed uploading image ${img.originalName} to WordPress:`, mediaErr);
        // Proceed anyway but log error
      }
    }

    // 4. Determine featured media ID
    let wpFeaturedMediaId = 0;
    if (featuredImage && wpImageMap[featuredImage.id]) {
      wpFeaturedMediaId = wpImageMap[featuredImage.id].id;
    }

    // 5. Generate final HTML content with live uploaded image URLs
    const paragraphs = (project.formattedContent || project.articleContent)
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    const markdownToHtml = (text: string) => {
      return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
    };

    let htmlContent = '';
    paragraphs.forEach((p, idx) => {
      if (p.startsWith('###')) {
        htmlContent += `<!-- wp:heading {"level":3} -->\n<h3>${markdownToHtml(p.replace('###', '').trim())}</h3>\n<!-- /wp:heading -->\n\n`;
      } else if (p.startsWith('##')) {
        htmlContent += `<!-- wp:heading -->\n<h2>${markdownToHtml(p.replace('##', '').trim())}</h2>\n<!-- /wp:heading -->\n\n`;
      } else {
        htmlContent += `<!-- wp:paragraph -->\n<p>${markdownToHtml(p)}</p>\n<!-- /wp:paragraph -->\n\n`;
      }

      // Append matched images with Gutenberg blocks and live WordPress urls
      const matchedImgs = activeImages.filter(img => img.placement === `after paragraph ${idx}`);
      matchedImgs.forEach(img => {
        const wpMedia = wpImageMap[img.id];
        if (wpMedia) {
          htmlContent += `<!-- wp:image {"id":${wpMedia.id},"sizeSlug":"large","linkDestination":"none"} -->\n<figure class="wp-block-image size-large"><img src="${wpMedia.url}" alt="${img.altText || ''}" class="wp-image-${wpMedia.id}" title="${img.seoFilename}"/>${img.caption ? `<figcaption class="wp-element-caption">${img.caption}</figcaption>` : ''}</figure>\n<!-- /wp:image -->\n\n`;
        } else {
          // Fallback if upload failed
          htmlContent += `<!-- wp:image -->\n<figure class="wp-block-image size-large"><img src="${img.localPath}" alt="${img.altText || ''}" title="${img.seoFilename}"/>${img.caption ? `<figcaption class="wp-element-caption">${img.caption}</figcaption>` : ''}</figure>\n<!-- /wp:image -->\n\n`;
        }
      });
    });

    // 6. Post final optimized payload to WordPress API
    console.log(`[WP Post] Creating post on ${cleanWpUrl}...`);
    
    const postPayload = {
      title: project.seoData?.seoTitle || project.title,
      content: htmlContent,
      status: status || 'draft',
      slug: project.seoData?.slug || '',
      categories: project.selectedCategoryIds || [],
      featured_media: wpFeaturedMediaId > 0 ? wpFeaturedMediaId : undefined,
      meta: {
        _yoast_wpseo_focuskw: project.seoData?.focusKeyword || '',
        _yoast_wpseo_metadesc: project.seoData?.metaDescription || ''
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
    console.log(`[WP Post] Success! Live Link: ${livePost.link}`);

    return NextResponse.json({
      success: true,
      link: livePost.link,
      id: livePost.id
    });
  } catch (e: any) {
    console.error("WordPress publish error:", e);
    return NextResponse.json({ error: e.message || 'Failed to publish post to WordPress' }, { status: 500 });
  }
}
