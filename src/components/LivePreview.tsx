import React from 'react';
import { ImageDetail, SEOData } from '@/lib/db';

interface LivePreviewProps {
  articleContent: string;
  images: ImageDetail[];
  seoData: SEOData;
  onUpdateSEO: (updatedFields: Partial<SEOData>) => void;
}

function parseMarkdownInline(text: string): React.ReactNode {
  // First handle links, then bold/italic
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const segments: React.ReactNode[] = [];
  let lastIndex = 0;
  let linkMatch;

  while ((linkMatch = linkRegex.exec(text)) !== null) {
    // Process text before the link for bold/italic
    if (linkMatch.index > lastIndex) {
      segments.push(...parseBoldItalic(text.slice(lastIndex, linkMatch.index), lastIndex));
    }
    segments.push(
      <a key={`link-${linkMatch.index}`} href={linkMatch[2]} className="text-primary underline hover:text-primary-hover" target="_blank" rel="noopener noreferrer">
        {linkMatch[1]}
      </a>
    );
    lastIndex = linkMatch.index + linkMatch[0].length;
  }

  // Process remaining text after last link
  if (lastIndex < text.length) {
    segments.push(...parseBoldItalic(text.slice(lastIndex), lastIndex));
  }

  return segments.length > 0 ? segments : parseBoldItalic(text, 0);
}

function parseBoldItalic(text: string, keyOffset: number): React.ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`bi-${keyOffset}-${index}`} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={`bi-${keyOffset}-${index}`} className="italic text-slate-700">{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

export default function LivePreview({ articleContent, images, seoData, onUpdateSEO }: LivePreviewProps) {
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

  const paragraphs = stripImagePlaceholders(articleContent)
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const featuredImage = images.find(img => img.isFeatured && !img.doNotUse);

  const metaDescLength = seoData.metaDescription?.length || 0;
  const isMetaLengthOk = metaDescLength <= 160 && metaDescLength > 100;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fadeIn">
      {/* Left Columns: Gutenberg-Style Live Preview */}
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-white p-8 rounded-2xl border border-card-border shadow-sm">
          <div className="border-b border-slate-100 pb-6 mb-6">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">WordPress Post Preview</span>
            <h1 className="text-3xl font-extrabold text-slate-900 leading-tight">
              {seoData.seoTitle || 'Untitled Post'}
            </h1>
          </div>

          {/* Featured Image Banner */}
          {featuredImage && (
            <div className="mb-8 rounded-2xl overflow-hidden border border-slate-100 bg-slate-50 relative aspect-[21/9]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={featuredImage.localPath}
                alt={featuredImage.altText}
                className="object-cover w-full h-full"
              />
              <div className="absolute bottom-2 right-2 bg-emerald-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow backdrop-blur-sm">
                ★ Featured Image
              </div>
            </div>
          )}

          {/* Render Gutenberg Blocks */}
          <div className="wp-preview-content font-serif">
            {paragraphs.map((p, idx) => {
              let element = null;
              if (p.startsWith('###')) {
                element = <h3 className="font-sans text-xl font-bold text-slate-800 mt-6 mb-3">{parseMarkdownInline(p.replace('###', '').trim())}</h3>;
              } else if (p.startsWith('##')) {
                element = <h2 className="font-sans text-2xl font-bold text-slate-950 mt-8 mb-4 border-b border-slate-100 pb-2">{parseMarkdownInline(p.replace('##', '').trim())}</h2>;
              } else {
                element = <p className="text-slate-700 leading-relaxed mb-4">{parseMarkdownInline(p)}</p>;
              }

              // Check for images placed after this paragraph
              const matchedImages = images.filter(
                (img) => !img.doNotUse && img.placement === `after paragraph ${idx}`
              );

              return (
                <React.Fragment key={idx}>
                  {element}
                  {matchedImages.map((img) => (
                    <div key={img.id} className="my-6 border border-slate-100 bg-slate-50/50 p-4 rounded-xl shadow-sm text-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.localPath}
                        alt={img.altText}
                        title={img.seoFilename}
                        className="mx-auto rounded-lg shadow max-h-[400px] object-contain"
                      />
                      {img.caption && (
                        <div className="text-xs text-slate-500 mt-2 italic">
                          {img.caption}
                        </div>
                      )}
                      <div className="text-[10px] text-slate-400 mt-2 pt-2 border-t border-slate-100/50 flex flex-wrap justify-center gap-x-4 gap-y-1">
                        <div>🏷️ Alt: <span className="font-medium text-slate-600">&ldquo;{img.altText}&rdquo;</span></div>
                        <div>📂 File: <span className="font-medium text-slate-600">{img.seoFilename}</span></div>
                      </div>
                    </div>
                  ))}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right Column: SEO Audit Panel */}
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-2xl border border-card-border shadow-sm space-y-6">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            📊 SEO Metrics & Metadata
          </h2>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">SEO Meta Title</label>
              <input
                type="text"
                value={seoData.seoTitle}
                onChange={(e) => onUpdateSEO({ seoTitle: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/20"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">Optimal length: 50-60 characters</span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">Meta Description</label>
                <span className={`text-[10px] font-bold ${isMetaLengthOk ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {metaDescLength}/160 chars
                </span>
              </div>
              <textarea
                value={seoData.metaDescription}
                onChange={(e) => onUpdateSEO({ metaDescription: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/20 font-sans"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">optimal: 120-160 characters</span>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">URL Slug</label>
              <input
                type="text"
                value={seoData.slug}
                onChange={(e) => onUpdateSEO({ slug: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/20"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">Focus Keyword</label>
              <input
                type="text"
                value={seoData.focusKeyword}
                onChange={(e) => onUpdateSEO({ focusKeyword: e.target.value })}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/20 font-semibold"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">Related Keywords</label>
              <div className="flex flex-wrap gap-1 mt-1">
                {seoData.relatedKeywords.map((kw, i) => (
                  <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium border border-slate-200/50">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Pinterest Preview */}
        {seoData.pinterestTitle && (
          <div className="bg-white p-6 rounded-2xl border border-card-border shadow-sm space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1">
              📌 Pinterest Details
            </h3>
            <div className="border border-slate-100 rounded-xl p-4 bg-slate-50/40 space-y-2">
              <div className="text-xs font-bold text-slate-800 line-clamp-1">{seoData.pinterestTitle}</div>
              <div className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">{seoData.pinterestDescription}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
