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

  // Publish to WordPress REST API
  const handlePublish = async (status: 'draft' | 'publish') => {
    if (!wpUrl || !wpUser || !wpPassword) {
      alert('Please fill in WordPress URL, username, and Application Password in Settings.');
      return;
    }

    setIsPosting(true);
    setPostStatus(null);
    setPublishProgress('');

    // Save settings locally in database
    const updated = {
      ...project,
      wpSettings: {
        siteUrl: wpUrl,
        username: wpUser,
        hasPassword: true
      }
    };
    onUpdateProject(updated);

    try {
      const res = await fetch('/api/wordpress/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          projectId: project.id,
          wpUrl,
          wpUser,
          wpPassword,
          status
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Publish API error ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("Could not initialize publish chunk reader.");
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let successData = null;
      let streamError: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let parsed: any = null;
          try {
            parsed = JSON.parse(line.trim());
          } catch (parseErr) {
            // Not valid JSON — skip this line silently
            continue;
          }
          if (parsed.type === 'progress') {
            setPublishProgress(parsed.message);
          } else if (parsed.type === 'success') {
            successData = parsed.data;
          } else if (parsed.type === 'error') {
            streamError = parsed.error;
            break;
          }
        }

        // Stop reading if we got an error event from server
        if (streamError) break;
      }

      // Throw server-side error AFTER breaking out of the read loop
      if (streamError) {
        throw new Error(streamError);
      }

      if (successData && successData.success) {
        setPostStatus({
          type: 'success',
          message: `Post successfully created! View here: ${successData.link}`
        });
      } else {
        throw new Error("Failed to retrieve publication confirmation.");
      }
    } catch (e: any) {
      setPostStatus({
        type: 'error',
        message: `Publish Error: ${e.message || 'Failed to connect to WordPress'}`
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
