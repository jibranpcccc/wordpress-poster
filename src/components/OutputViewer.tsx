import React, { useState } from 'react';
import { Project, ImageDetail } from '@/lib/db';
import JSZip from 'jszip';

interface OutputViewerProps {
  project: Project;
  onUpdateProject: (updatedProject: Project) => void;
}

export default function OutputViewer({ project, onUpdateProject }: OutputViewerProps) {
  const [wpUrl, setWpUrl] = useState('');
  const [wpUser, setWpUser] = useState('');
  const [wpPassword, setWpPassword] = useState('');

  // Load WP settings on mount
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      setWpUrl(localStorage.getItem('wp_active_site_url') || localStorage.getItem('wp_site_url') || project.wpSettings?.siteUrl || '');
      setWpUser(localStorage.getItem('wp_active_username') || localStorage.getItem('wp_username') || project.wpSettings?.username || '');
      setWpPassword(localStorage.getItem('wp_password') || '');
    }
  }, [project.wpSettings]);

  const handleWpUrlChange = (val: string) => {
    setWpUrl(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('wp_site_url', val);
      localStorage.setItem('wp_active_site_url', val);
    }
  };

  const handleWpUserChange = (val: string) => {
    setWpUser(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('wp_username', val);
      localStorage.setItem('wp_active_username', val);
    }
  };

  const handleWpPasswordChange = (val: string) => {
    setWpPassword(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('wp_password', val);
    }
  };
  const [isPosting, setIsPosting] = useState(false);
  const [postStatus, setPostStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [publishProgress, setPublishProgress] = useState('');

  const activeImages = project.images.filter(img => !img.doNotUse);
  const unusedImages = project.images.filter(img => img.doNotUse);
  const featuredImage = activeImages.find(img => img.isFeatured);

  const paragraphs = (project.formattedContent || project.articleContent)
    .split('\n')
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const markdownToHtml = (text: string) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  };

  // Generate Gutenberg Block Code
  const getGutenbergContent = () => {
    let output = '';
    paragraphs.forEach((p, idx) => {
      if (p.startsWith('###')) {
        output += `<!-- wp:heading {"level":3} -->\n<h3>${markdownToHtml(p.replace('###', '').trim())}</h3>\n<!-- /wp:heading -->\n\n`;
      } else if (p.startsWith('##')) {
        output += `<!-- wp:heading -->\n<h2>${markdownToHtml(p.replace('##', '').trim())}</h2>\n<!-- /wp:heading -->\n\n`;
      } else {
        output += `<!-- wp:paragraph -->\n<p>${markdownToHtml(p)}</p>\n<!-- /wp:paragraph -->\n\n`;
      }

      // Check for image placement
      const matchedImgs = activeImages.filter(img => img.placement === `after paragraph ${idx}`);
      matchedImgs.forEach(img => {
        output += `<!-- wp:image {"alt":"${img.altText}"} -->\n<figure class="wp-block-image"><img src="${img.localPath}" alt="${img.altText}" title="${img.seoFilename}"/>${img.caption ? `<figcaption class="wp-element-caption">${img.caption}</figcaption>` : ''}</figure>\n<!-- /wp:image -->\n\n`;
      });
    });
    return output;
  };

  // Generate plain HTML
  const getHTMLContent = () => {
    let output = '';
    paragraphs.forEach((p, idx) => {
      if (p.startsWith('###')) {
        output += `<h3>${markdownToHtml(p.replace('###', '').trim())}</h3>\n`;
      } else if (p.startsWith('##')) {
        output += `<h2>${markdownToHtml(p.replace('##', '').trim())}</h2>\n`;
      } else {
        output += `<p>${markdownToHtml(p)}</p>\n`;
      }

      const matchedImgs = activeImages.filter(img => img.placement === `after paragraph ${idx}`);
      matchedImgs.forEach(img => {
        output += `<figure class="wp-caption">\n  <img src="${img.localPath}" alt="${img.altText}" title="${img.seoFilename}" />\n  ${img.caption ? `<figcaption class="wp-caption-text">${img.caption}</figcaption>` : ''}\n</figure>\n`;
      });
    });
    return output;
  };

  // Build the copyable final structured text requested by user
  const getStructuredTextOutput = () => {
    let postText = '';
    paragraphs.forEach((p, idx) => {
      postText += p + '\n\n';
      const matchedImgs = activeImages.filter(img => img.placement === `after paragraph ${idx}`);
      matchedImgs.forEach(img => {
        postText += `[IMAGE: ${img.seoFilename}]\n`;
        postText += `Alt text: "${img.altText}"\n`;
        if (img.caption) {
          postText += `Caption: "${img.caption}"\n`;
        }
        postText += '\n';
      });
    });

    const imageTable = activeImages.map(img => 
      `* Original: ${img.originalName} | New SEO Filename: ${img.seoFilename} | Placement: ${img.placement} | Alt: "${img.altText}" | Caption: "${img.caption || 'None'}"`
    ).join('\n');

    const unusedText = unusedImages.length > 0
      ? unusedImages.map(img => `* ${img.originalName} - Reason: ${img.notes || 'Excluded by user'}`).join('\n')
      : 'None';

    return `A. SEO Title
${project.seoData?.seoTitle || ''}

B. Meta Description
${project.seoData?.metaDescription || ''}

C. URL Slug
${project.seoData?.slug || ''}

D. Focus Keyword
${project.seoData?.focusKeyword || ''}

E. Related Keywords
${(project.seoData?.relatedKeywords || []).join(', ')}

F. Featured Image Recommendation
${featuredImage ? featuredImage.seoFilename : 'None selected'}

G. Final WordPress Post
${postText.trim()}

H. Image SEO Table
${imageTable}

I. Unused / Not Recommended Images
${unusedText}`;
  };

  // Copy to Clipboard
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    alert(`${label} copied to clipboard!`);
  };

  // Download files
  const downloadTextFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Export CSV SEO Table
  const downloadCSV = () => {
    let csv = 'Original image name,New SEO filename,Recommended placement,Alt text,Caption,Notes\n';
    project.images.forEach(img => {
      const row = [
        img.originalName,
        img.seoFilename,
        img.placement,
        img.altText,
        img.caption || '',
        img.notes || (img.doNotUse ? 'Not recommended' : 'Matched')
      ].map(val => `"${val.replace(/"/g, '""')}"`).join(',');
      csv += row + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.seoData?.slug || 'image-seo'}-table.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Export ZIP Archive
  const downloadZip = async () => {
    const zip = new JSZip();
    
    // Add text article
    zip.file('structured-post.txt', getStructuredTextOutput());
    zip.file('article-gutenberg.html', getGutenbergContent());
    
    // Add images
    for (const img of activeImages) {
      try {
        const response = await fetch(img.localPath);
        const blob = await response.blob();
        zip.file(img.seoFilename, blob);
      } catch (e) {
        console.error(`Failed to fetch image ${img.originalName} for ZIP export:`, e);
      }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.seoData?.slug || 'wordpress-post'}-package.zip`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Publish to WordPress REST API — uses client-side direct publishing
  // (browser calls WordPress directly from user's own IP, bypassing server IP blocks)
  const handlePublish = async (status: 'draft' | 'publish') => {
    if (!wpUrl || !wpUser || !wpPassword) {
      alert('Please fill in WordPress URL, username, and Application Password in Settings.');
      return;
    }

    setIsPosting(true);
    setPostStatus(null);
    setPublishProgress('');

    const updated = {
      ...project,
      wpSettings: { siteUrl: wpUrl, username: wpUser, hasPassword: true }
    };
    onUpdateProject(updated);

    try {
      // Step 1: Fetch project data + image blobs from our server
      setPublishProgress('Fetching project data...');
      const dataRes = await fetch(`/api/wordpress/publish-data?projectId=${project.id}`);
      if (!dataRes.ok) {
        const e = await dataRes.json().catch(() => ({}));
        throw new Error(e.error || 'Could not load project data');
      }
      const { project: fullProject } = await dataRes.json();

      const cleanWpUrl = wpUrl.replace(/\/$/, '');
      const authHeader = 'Basic ' + btoa(`${wpUser}:${wpPassword}`);

      const activeImages = fullProject.images.filter((img: any) => !img.doNotUse);
      const featuredImage = activeImages.find((img: any) => img.isFeatured);
      const wpImageMap: Record<string, { id: number; url: string }> = {};

      // Step 2: Upload images directly from browser to WordPress
      // The browser uses the USER's own IP — no server IP blocks apply
      setPublishProgress(`Uploading ${activeImages.length} image(s) to WordPress...`);

      const BATCH = 3;
      for (let i = 0; i < activeImages.length; i += BATCH) {
        const batch = activeImages.slice(i, i + BATCH);
        const batchNum = Math.floor(i / BATCH) + 1;
        const totalBatches = Math.ceil(activeImages.length / BATCH);
        setPublishProgress(`Uploading images batch ${batchNum}/${totalBatches}...`);

        await Promise.all(batch.map(async (img: any) => {
          try {
            if (img.wpMediaId) {
              wpImageMap[img.id] = { id: img.wpMediaId, url: img.localPath };
              return;
            }
            if (!img.base64Data) return;

            const mimeType = img.mimeType || 'image/jpeg';
            const byteChars = atob(img.base64Data);
            const byteArr = new Uint8Array(byteChars.length);
            for (let j = 0; j < byteChars.length; j++) byteArr[j] = byteChars.charCodeAt(j);
            const blob = new Blob([byteArr], { type: mimeType });

            const upRes = await fetch(`${cleanWpUrl}/wp-json/wp/v2/media`, {
              method: 'POST',
              headers: {
                'Authorization': authHeader,
                'Content-Disposition': `attachment; filename="${img.seoFilename}"`,
                'Content-Type': mimeType,
              },
              body: blob,
            });

            if (!upRes.ok) {
              console.warn(`Image upload failed for ${img.originalName}: ${upRes.status}`);
              return;
            }
            const media = await upRes.json();

            // Update SEO metadata (fire and forget)
            fetch(`${cleanWpUrl}/wp-json/wp/v2/media/${media.id}`, {
              method: 'POST',
              headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                alt_text: img.altText || '',
                caption: img.caption || '',
                title: img.seoFilename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
                description: img.notes || '',
              }),
            }).catch(() => {});

            wpImageMap[img.id] = { id: media.id, url: media.source_url };
          } catch (imgErr: any) {
            console.warn(`Skipping image ${img.originalName}:`, imgErr.message);
          }
        }));
      }

      // Step 3: Resolve tags
      setPublishProgress('Resolving tags...');
      const tagIds: number[] = [];
      if (fullProject.tags) {
        const tagNames = fullProject.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
        for (const name of tagNames) {
          try {
            const searchRes = await fetch(
              `${cleanWpUrl}/wp-json/wp/v2/tags?search=${encodeURIComponent(name)}`,
              { headers: { 'Authorization': authHeader } }
            );
            if (searchRes.ok) {
              const existing = await searchRes.json();
              const match = Array.isArray(existing) && existing.find((t: any) => t.name.toLowerCase() === name.toLowerCase());
              if (match) { tagIds.push(match.id); continue; }
            }
            const createRes = await fetch(`${cleanWpUrl}/wp-json/wp/v2/tags`, {
              method: 'POST',
              headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
              body: JSON.stringify({ name }),
            });
            if (createRes.ok) { const t = await createRes.json(); tagIds.push(t.id); }
          } catch (e) {}
        }
      }

      // Step 4: Build Gutenberg HTML content
      const stripPlaceholders = (text: string) => text.split('\n').filter(line => {
        const c = line.trim().replace(/^[\*\s_"'""[]+/, '').toLowerCase();
        if (c.startsWith('image:') || c.startsWith('[image:') || c.startsWith('alt text:') ||
            c.startsWith('alt tag:') || c.startsWith('caption:') || c.startsWith('filename:') ||
            c.startsWith('seo filename:')) return false;
        const t = line.trim();
        if (t === '*' || t === '**' || t === '_' || t === '__') return false;
        return true;
      }).join('\n');

      const mdToHtml = (text: string) => text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');

      const isHeading = (text: string) => {
        const t = text.trim();
        if (!t || t.length > 85) return false;
        if (t.startsWith('#')) return true;
        if (/[.?!]$/.test(t)) return false;
        if (t.includes('<') && t.includes('>')) return false;
        if (!/^[A-Z0-9"'""]/.test(t)) return false;
        return t.split(/\s+/).length <= 12;
      };

      const articleText = stripPlaceholders(fullProject.formattedContent || fullProject.articleContent);
      const paragraphs = articleText.split('\n').map((p: string) => p.trim()).filter(Boolean);
      let htmlContent = '';

      paragraphs.forEach((p: string, idx: number) => {
        const t = p.trim();
        if (t.startsWith('<!-- wp:') || t.startsWith('<!-- /wp:') || t.startsWith('<figure') ||
            t.startsWith('</figure>') || t.startsWith('<img') || t.startsWith('<figcaption')) {
          htmlContent += t + '\n';
        } else if (t.startsWith('###') || (t.startsWith('#') && t.split('#').length - 1 === 3)) {
          htmlContent += `<!-- wp:heading {"level":3} -->\n<h3>${mdToHtml(t.replace(/^#+\s*/, ''))}</h3>\n<!-- /wp:heading -->\n\n`;
        } else if (t.startsWith('#') || isHeading(t)) {
          htmlContent += `<!-- wp:heading -->\n<h2>${mdToHtml(t.replace(/^#+\s*/, ''))}</h2>\n<!-- /wp:heading -->\n\n`;
        } else {
          htmlContent += `<!-- wp:paragraph -->\n<p>${mdToHtml(t)}</p>\n<!-- /wp:paragraph -->\n\n`;
        }
        activeImages.filter((img: any) => img.placement === `after paragraph ${idx}`).forEach((img: any) => {
          const wpMedia = wpImageMap[img.id];
          const cleanTitle = img.seoFilename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
          if (wpMedia) {
            htmlContent += `<!-- wp:image {"id":${wpMedia.id},"sizeSlug":"large","linkDestination":"none"} -->\n<figure class="wp-block-image size-large"><img src="${wpMedia.url}" alt="${img.altText || ''}" class="wp-image-${wpMedia.id}" title="${cleanTitle}"/>${img.caption ? `<figcaption class="wp-element-caption">${img.caption}</figcaption>` : ''}</figure>\n<!-- /wp:image -->\n\n`;
          }
        });
      });

      // Step 5: Create the WordPress post
      setPublishProgress('Creating WordPress post...');
      const featuredMediaId = featuredImage && wpImageMap[featuredImage.id] ? wpImageMap[featuredImage.id].id : 0;

      const postRes = await fetch(`${cleanWpUrl}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: fullProject.seoData?.seoTitle || fullProject.title,
          content: htmlContent,
          excerpt: fullProject.seoData?.metaDescription || '',
          status: status || 'draft',
          slug: fullProject.seoData?.slug || '',
          categories: fullProject.selectedCategoryIds || [],
          tags: tagIds,
          featured_media: featuredMediaId > 0 ? featuredMediaId : undefined,
          meta: {
            _yoast_wpseo_title: fullProject.seoData?.seoTitle || fullProject.title,
            _yoast_wpseo_focuskw: fullProject.seoData?.focusKeyword || '',
            _yoast_wpseo_metadesc: fullProject.seoData?.metaDescription || '',
            rank_math_title: fullProject.seoData?.seoTitle || fullProject.title,
            rank_math_description: fullProject.seoData?.metaDescription || '',
            rank_math_focus_keyword: fullProject.seoData?.focusKeyword || '',
          },
        }),
      });

      if (!postRes.ok) {
        const errData = await postRes.json().catch(() => ({}));
        throw new Error(`WordPress error: ${errData.message || postRes.statusText}`);
      }

      const livePost = await postRes.json();

      // Clean up Firestore in background
      fetch(`/api/wordpress/publish-data?projectId=${project.id}`, { method: 'DELETE' }).catch(() => {});

      setPostStatus({
        type: 'success',
        message: `Post successfully created! View here: ${livePost.link}`,
      });

    } catch (e: any) {
      setPostStatus({
        type: 'error',
        message: `Publish Error: ${e.message || 'Failed to connect to WordPress'}`,
      });
    } finally {
      setIsPosting(false);
      setPublishProgress('');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fadeIn">
      {/* Left 2 Columns: Output structured text */}
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-white p-6 rounded-2xl border border-card-border shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <h2 className="text-lg font-bold text-slate-900">📝 Final Output Format</h2>
            <button
              onClick={() => copyToClipboard(getStructuredTextOutput(), 'Structured post')}
              className="text-xs font-semibold text-primary hover:bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200"
            >
              Copy All Text
            </button>
          </div>
          <pre className="p-4 bg-slate-50 text-slate-800 rounded-xl font-mono text-xs overflow-auto max-h-[500px] leading-relaxed whitespace-pre-wrap">
            {getStructuredTextOutput()}
          </pre>
        </div>
      </div>

      {/* Right Column: Actions & Exporters */}
      <div className="space-y-6">
        {/* Export Options */}
        <div className="bg-white p-6 rounded-2xl border border-card-border shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-900">💾 Export Project</h2>
          <div className="grid grid-cols-1 gap-2.5">
            <button
              onClick={() => copyToClipboard(getHTMLContent(), 'HTML Content')}
              className="w-full text-left px-4 py-3 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition duration-150 flex items-center justify-between"
            >
              <span>📋 Copy WordPress HTML</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
              </svg>
            </button>

            <button
              onClick={() => copyToClipboard(getGutenbergContent(), 'Gutenberg Blocks')}
              className="w-full text-left px-4 py-3 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition duration-150 flex items-center justify-between"
            >
              <span>📋 Copy Gutenberg Blocks</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
              </svg>
            </button>

            <button
              onClick={() => downloadTextFile(getStructuredTextOutput(), `${project.seoData?.slug || 'post'}.txt`)}
              className="w-full text-left px-4 py-3 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition duration-150 flex items-center justify-between"
            >
              <span>📥 Download as .txt</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2-8H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2z" />
              </svg>
            </button>

            <button
              onClick={() => downloadTextFile(getHTMLContent(), `${project.seoData?.slug || 'post'}.html`)}
              className="w-full text-left px-4 py-3 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition duration-150 flex items-center justify-between"
            >
              <span>📥 Download as .html</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2-8H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2z" />
              </svg>
            </button>

            <button
              onClick={downloadCSV}
              className="w-full text-left px-4 py-3 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition duration-150 flex items-center justify-between"
            >
              <span>📊 Download SEO CSV Table</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>

            <button
              onClick={downloadZip}
              className="w-full text-left px-4 py-3 bg-primary/10 hover:bg-primary/15 text-primary text-xs font-bold rounded-xl border border-primary/20 transition duration-150 flex items-center justify-between shadow-sm"
            >
              <span>📦 Export Project Package (.zip)</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-2m-4-1v8m0 0l3-3m-3 3L9 8m-5 5h2.586a1 1 0 01.707.293l2.414 2.414a1 1 0 001.414 0l2.414-2.414a1 1 0 01.707-.293H20" />
              </svg>
            </button>
          </div>
        </div>

        {/* Optional WordPress Publish Settings */}
        <div className="bg-white p-6 rounded-2xl border border-card-border shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-900">🌐 WordPress REST API (Optional)</h2>
          
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">WordPress Site URL</label>
              <input
                type="url"
                value={wpUrl}
                onChange={(e) => handleWpUrlChange(e.target.value)}
                placeholder="https://tresscribe.com"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/20"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">WP Username</label>
              <input
                type="text"
                value={wpUser}
                onChange={(e) => handleWpUserChange(e.target.value)}
                placeholder="admin"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/20"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">WP Application Password</label>
              <input
                type="password"
                value={wpPassword}
                onChange={(e) => handleWpPasswordChange(e.target.value)}
                placeholder="xxxx xxxx xxxx xxxx xxxx"
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/20"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => handlePublish('draft')}
                disabled={isPosting}
                className="w-full py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition"
              >
                Save as Draft
              </button>

              <button
                onClick={() => handlePublish('publish')}
                disabled={isPosting}
                className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition"
              >
                Publish Now
              </button>
            </div>

            {isPosting && (
              <div className="text-[10px] font-semibold text-primary animate-pulse text-center pt-2">
                {publishProgress || 'Sending data to WordPress...'}
              </div>
            )}

            {postStatus && (
              <div className={`p-3 rounded-lg text-xs leading-normal mt-2 border ${
                postStatus.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-rose-50 text-rose-800 border-rose-100'
              }`}>
                {postStatus.message}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
