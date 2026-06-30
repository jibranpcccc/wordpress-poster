import React from 'react';
import { ImageDetail } from '@/lib/db';

interface ImageManagerProps {
  images: ImageDetail[];
  onUpdateImage: (id: string, updatedFields: Partial<ImageDetail>) => void;
  paragraphsCount: number;
}

export default function ImageManager({ images, onUpdateImage, paragraphsCount }: ImageManagerProps) {
  
  const handleFeaturedChange = (selectedId: string) => {
    // Make only the selected ID featured, uncheck all others
    images.forEach(img => {
      onUpdateImage(img.id, { isFeatured: img.id === selectedId });
    });
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Match & Manage Images</h2>
        <p className="text-sm text-muted mt-1">Review, rename, and position images inside your post. You can edit any fields manually.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {images.map((img) => (
          <div
            key={img.id}
            className={`p-6 rounded-2xl border bg-white shadow-sm flex flex-col md:flex-row gap-6 transition ${
              img.doNotUse ? 'border-rose-200 bg-rose-50/10 opacity-70' : 'border-card-border hover:border-slate-300'
            }`}
          >
            {/* Image Preview & Toggles */}
            <div className="w-full md:w-48 flex flex-col gap-3 shrink-0">
              <div className="relative rounded-xl overflow-hidden border border-slate-100 aspect-video md:aspect-square bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.localPath} alt={img.originalName} className="object-cover w-full h-full" />
                {img.isFeatured && (
                  <span className="absolute top-2 left-2 bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">
                    ★ Featured
                  </span>
                )}
              </div>
              <div className="text-[10px] text-muted truncate text-center" title={img.originalName}>
                Original: {img.originalName}
              </div>

              {/* Quick Actions */}
              <div className="space-y-2 mt-2">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="featured-image"
                    checked={img.isFeatured}
                    disabled={img.doNotUse}
                    onChange={() => handleFeaturedChange(img.id)}
                    className="h-4 w-4 text-primary focus:ring-primary border-slate-300 rounded"
                  />
                  Featured Image
                </label>

                <label className="flex items-center gap-2 text-xs font-semibold text-rose-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={img.doNotUse}
                    onChange={(e) => {
                      onUpdateImage(img.id, { 
                        doNotUse: e.target.checked,
                        // Clear featured status if marking as unused
                        isFeatured: e.target.checked ? false : img.isFeatured 
                      });
                    }}
                    className="h-4 w-4 text-rose-600 focus:ring-rose-500 border-slate-300 rounded"
                  />
                  Do Not Use Image
                </label>
              </div>
            </div>

            {/* Editable Fields */}
            <div className="flex-1 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">SEO Filename</label>
                  <input
                    type="text"
                    value={img.seoFilename}
                    disabled={img.doNotUse}
                    onChange={(e) => onUpdateImage(img.id, { seoFilename: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/20 disabled:bg-slate-100 disabled:cursor-not-allowed"
                    placeholder="SEO-friendly-name.jpg"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">Placement (After Paragraph)</label>
                  <select
                    value={img.placement.match(/\d+/) ? img.placement.match(/\d+/)![0] : '0'}
                    disabled={img.doNotUse}
                    onChange={(e) => onUpdateImage(img.id, { placement: `after paragraph ${e.target.value}` })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/20 disabled:bg-slate-100 disabled:cursor-not-allowed"
                  >
                    {Array.from({ length: paragraphsCount }).map((_, idx) => (
                      <option key={idx} value={idx}>Paragraph {idx + 1}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">SEO Alt Text</label>
                <input
                  type="text"
                  value={img.altText}
                  disabled={img.doNotUse}
                  onChange={(e) => onUpdateImage(img.id, { altText: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/20 disabled:bg-slate-100 disabled:cursor-not-allowed"
                  placeholder="Alt text describing what is visible in the image..."
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">Caption (Optional)</label>
                <input
                  type="text"
                  value={img.caption}
                  disabled={img.doNotUse}
                  onChange={(e) => onUpdateImage(img.id, { caption: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/20 disabled:bg-slate-100 disabled:cursor-not-allowed"
                  placeholder="Optional image caption..."
                />
              </div>

              {img.doNotUse ? (
                <div>
                  <label className="text-xs font-bold text-rose-700 uppercase tracking-wider block mb-1">Reason for Exclusion</label>
                  <input
                    type="text"
                    value={img.notes}
                    onChange={(e) => onUpdateImage(img.id, { notes: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-rose-200 rounded-lg focus:outline-none bg-rose-50/20 text-rose-800"
                    placeholder="Explain why this image does not match the content..."
                  />
                </div>
              ) : (
                <div className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-1 rounded inline-block">
                  🎯 Match Notes: {img.notes || 'Image matched successfully.'}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
