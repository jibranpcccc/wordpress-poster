import React, { useState, useRef, useEffect } from 'react';
import { ImageDetail } from '@/lib/db';

interface NewPostFormProps {
  onAnalyze: (data: {
    title: string;
    articleContent: string;
    mainKeyword: string;
    relatedKeywords: string;
    category: string;
    tags: string;
    images: { originalName: string; localPath: string; wpMediaId?: number }[];
    model: string;
    customApiKey: string;
    customGeminiKey: string;
    customSeoTitle?: string;
    customMetaDescription?: string;
    customSlug?: string;
    visionProvider?: string;
  }) => void;
  isAnalyzing: boolean;
}

export default function NewPostForm({ onAnalyze, isAnalyzing }: NewPostFormProps) {
  const [title, setTitle] = useState('');
  const [mainKeyword, setMainKeyword] = useState('');
  const [relatedKeywords, setRelatedKeywords] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [articleContent, setArticleContent] = useState('');
  const [model, setModel] = useState('cloudflare-llama-3.3-70b');
  const [visionProvider, setVisionProvider] = useState('cloudflare');
  
  // Custom SEO states
  const [useCustomSEO, setUseCustomSEO] = useState(false);
  const [customSeoTitle, setCustomSeoTitle] = useState('');
  const [customMetaDescription, setCustomMetaDescription] = useState('');
  const [customSlug, setCustomSlug] = useState('');

  const [customApiKey, setCustomApiKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('opencode_zen_api_key') || '';
    }
    return '';
  });
  const [customGeminiKey, setCustomGeminiKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gemini_api_key') || '';
    }
    return '';
  });

  const handleApiKeyChange = (val: string) => {
    setCustomApiKey(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('opencode_zen_api_key', val);
    }
  };

  const handleGeminiKeyChange = (val: string) => {
    setCustomGeminiKey(val);
    if (typeof window !== 'undefined') {
      localStorage.setItem('gemini_api_key', val);
    }
  };
  
  const [uploadedImages, setUploadedImages] = useState<{ originalName: string; localPath: string; size: number; wpMediaId?: number }[]>([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [isUploadingArticle, setIsUploadingArticle] = useState(false);
  
  const imageInputRef = useRef<HTMLInputElement>(null);
  const articleInputRef = useRef<HTMLInputElement>(null);

  // Handle Drag & Drop states
  const [isDragOverImage, setIsDragOverImage] = useState(false);
  const [isDragOverArticle, setIsDragOverArticle] = useState(false);

  // Handle article upload (txt / md)
  const handleArticleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    
    setIsUploadingArticle(true);
    const formData = new FormData();
    formData.append('files', file);
    formData.append('isTextFile', 'true');

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success && data.content) {
        setArticleContent(data.content);
        // Autofill title if empty
        if (!title) {
          const baseName = file.name.replace(/\.[^/.]+$/, "").replace(/[_\-]/g, " ");
          setTitle(baseName.charAt(0).toUpperCase() + baseName.slice(1));
        }
      } else {
        alert(data.error || 'Failed to read article file');
      }
    } catch (e) {
      console.error(e);
      alert('Error uploading article file');
    } finally {
      setIsUploadingArticle(false);
    }
  };

  // Downscale and compress image client-side to make uploads 10x faster and prevent server timeouts
  const compressImage = (file: File, maxWidth = 1000, maxHeight = 1000, quality = 0.85): Promise<Blob | File> => {
    return new Promise((resolve) => {
      if (!file.type.startsWith('image/')) {
        resolve(file);
        return;
      }
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              resolve(blob || file);
            },
            file.type || 'image/jpeg',
            quality
          );
        };
        img.onerror = () => resolve(file);
      };
      reader.onerror = () => resolve(file);
    });
  };

  // Handle images upload
  const handleImagesUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setIsUploadingImages(true);

    // Retrieve active WordPress credentials from localStorage
    const wpUrl = localStorage.getItem('wp_active_site_url') || localStorage.getItem('wp_site_url') || '';
    const storedSitesJson = localStorage.getItem('wp_saved_sites');
    let wpUser = '';
    let wpPassword = '';
    if (storedSitesJson && wpUrl) {
      try {
        const sites = JSON.parse(storedSitesJson);
        const site = sites.find((s: any) => s.siteUrl === wpUrl);
        if (site) {
          wpUser = site.username;
          wpPassword = site.password;
        }
      } catch (e) {}
    }

    const uploadFile = async (file: File) => {
      let finalFile: File = file;
      try {
        const compressedBlob = await compressImage(file);
        finalFile = new File([compressedBlob], file.name, { type: file.type });
      } catch (compressErr) {
        console.warn("Client-side compression failed for file:", file.name, compressErr);
      }

      const fd = new FormData();
      fd.append('files', finalFile);
      fd.append('isTextFile', 'false');
      if (wpUrl && wpUser && wpPassword) {
        fd.append('wpUrl', wpUrl);
        fd.append('wpUser', wpUser);
        fd.append('wpPassword', wpPassword);
      }

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: fd,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error ${res.status} during upload of ${file.name}`);
      }

      const data = await res.json();
      if (data.success && data.files && data.files.length > 0) {
        return data.files[0];
      } else {
        throw new Error(`Upload response did not return file details for ${file.name}`);
      }
    };

    try {
      const uploadPromises = Array.from(files).map((file) => uploadFile(file));
      const uploadedFiles = await Promise.all(uploadPromises);
      
      setUploadedImages(prev => [...prev, ...uploadedFiles]);
    } catch (e: any) {
      console.error(e);
      alert(`Error uploading images: ${e.message || e}`);
    } finally {
      setIsUploadingImages(false);
    }
  };


  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      alert('Please enter a project title.');
      return;
    }
    if (!articleContent.trim()) {
      alert('Please paste or upload article content.');
      return;
    }
    
    onAnalyze({
      title,
      articleContent,
      mainKeyword,
      relatedKeywords,
      category,
      tags,
      images: uploadedImages.map(img => ({ originalName: img.originalName, localPath: img.localPath, wpMediaId: img.wpMediaId })),
      model,
      customApiKey,
      customGeminiKey,
      customSeoTitle: useCustomSEO ? customSeoTitle : '',
      customMetaDescription: useCustomSEO ? customMetaDescription : '',
      customSlug: useCustomSEO ? customSlug : '',
      visionProvider
    });
  };

  return (
    <form onSubmit={handleFormSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fadeIn">
      {/* Left 2 Columns: Article & Image Uploads */}
      <div className="lg:col-span-2 space-y-6">
        {/* Article Section */}
        <div className="bg-white p-6 rounded-2xl border border-card-border shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            📄 Article Content
          </h2>
          
          {/* Article Upload Area */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOverArticle(true); }}
            onDragLeave={() => setIsDragOverArticle(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOverArticle(false);
              handleArticleUpload(e.dataTransfer.files);
            }}
            className={`border-2 border-dashed rounded-xl p-6 text-center transition cursor-pointer flex flex-col items-center justify-center ${
              isDragOverArticle ? 'border-primary bg-primary/5' : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50'
            }`}
            onClick={() => articleInputRef.current?.click()}
          >
            <input
              type="file"
              ref={articleInputRef}
              onChange={(e) => handleArticleUpload(e.target.files)}
              accept=".txt,.md"
              className="hidden"
            />
            {isUploadingArticle ? (
              <span className="text-sm font-semibold text-primary animate-pulse">Reading file...</span>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-slate-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm font-medium text-slate-700">Drag & drop your article file here</p>
                <p className="text-xs text-muted mt-1">Supports plain text (.txt) and Markdown (.md)</p>
              </>
            )}
          </div>

          <div className="relative">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-2">Or paste article text below:</label>
            <textarea
              value={articleContent}
              onChange={(e) => setArticleContent(e.target.value)}
              placeholder="Paste the full article content here..."
              rows={12}
              className="w-full p-4 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm font-sans bg-slate-50/20"
            />
          </div>
        </div>

        {/* Images Upload Section */}
        <div className="bg-white p-6 rounded-2xl border border-card-border shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            🖼️ Upload Post Images
          </h2>

          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOverImage(true); }}
            onDragLeave={() => setIsDragOverImage(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOverImage(false);
              handleImagesUpload(e.dataTransfer.files);
            }}
            className={`border-2 border-dashed rounded-xl p-6 text-center transition cursor-pointer flex flex-col items-center justify-center ${
              isDragOverImage ? 'border-primary bg-primary/5' : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50'
            }`}
            onClick={() => imageInputRef.current?.click()}
          >
            <input
              type="file"
              ref={imageInputRef}
              onChange={(e) => handleImagesUpload(e.target.files)}
              multiple
              accept="image/*"
              className="hidden"
            />
            {isUploadingImages ? (
              <span className="text-sm font-semibold text-primary animate-pulse">Uploading images...</span>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-slate-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-sm font-medium text-slate-700">Drag & drop multiple images here</p>
                <p className="text-xs text-muted mt-1">Supports JPG, PNG, WEBP</p>
              </>
            )}
          </div>

          {/* Uploaded Images Grid */}
          {uploadedImages.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Uploaded Images ({uploadedImages.length}):</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {uploadedImages.map((img, i) => (
                  <div key={i} className="relative group border border-slate-100 rounded-xl overflow-hidden shadow-sm bg-slate-50 aspect-video">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img 
                      src={img.localPath.includes('?') ? `${img.localPath}&t=${img.originalName}` : `${img.localPath}?t=${img.originalName}`} 
                      alt={img.originalName} 
                      className="object-cover w-full h-full" 
                    />

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setUploadedImages(prev => prev.filter((_, idx) => idx !== i));
                      }}
                      className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-rose-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition duration-150"
                      title="Remove Image"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <div className="absolute bottom-0 inset-x-0 bg-black/50 text-[10px] text-white p-1 truncate" title={img.originalName}>
                      {img.originalName}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Settings & CTA */}
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-2xl border border-card-border shadow-sm space-y-5">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            🏷️ SEO Settings
          </h2>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">Project Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Elegant Bob Hairstyles for Women"
                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/30"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">Focus Keyword</label>
              <input
                type="text"
                value={mainKeyword}
                onChange={(e) => setMainKeyword(e.target.value)}
                placeholder="e.g. bob hairstyles over 60"
                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/30"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">Related Keywords</label>
              <textarea
                value={relatedKeywords}
                onChange={(e) => setRelatedKeywords(e.target.value)}
                placeholder="bob haircuts, short hairstyles, layered bob (comma-separated)"
                rows={3}
                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/30 font-sans"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">Tags</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="e.g. hair, beauty"
                className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/30"
              />
            </div>

            <div className="pt-2 border-t border-slate-100/50">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useCustomSEO}
                  onChange={(e) => setUseCustomSEO(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500/20"
                />
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Manually enter Title, Slug & Desc
                </span>
              </label>
            </div>

            {useCustomSEO && (
              <div className="space-y-4 pt-3 border-t border-slate-100/50 animate-fadeIn">
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">Custom SEO Title</label>
                  <input
                    type="text"
                    value={customSeoTitle}
                    onChange={(e) => setCustomSeoTitle(e.target.value)}
                    placeholder="Enter SEO title (100% matches keyword if desired)"
                    className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/30"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">Custom Meta Description</label>
                  <textarea
                    value={customMetaDescription}
                    onChange={(e) => setCustomMetaDescription(e.target.value)}
                    placeholder="Enter meta description..."
                    rows={2}
                    className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/30 font-sans"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">Custom URL Slug</label>
                  <input
                    type="text"
                    value={customSlug}
                    onChange={(e) => setCustomSlug(e.target.value)}
                    placeholder="e.g. hair-trends-guide"
                    className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/30"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-card-border shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            ⚙️ AI Gateway Setup
          </h2>
          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">OpenCode Model</label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/30 font-medium text-slate-800"
            >
              <option value="cloudflare-llama-3.3-70b">☁️ Cloudflare Llama 3.3 70B (Recommended - State-of-the-Art, 0.7s Fast & Stable)</option>
              <option value="cloudflare-llama-3.1-70b">☁️ Cloudflare Llama 3.1 70B (0.7s Ultra Fast & 100% Stable)</option>
              <option value="cloudflare-llama-3.1-8b">☁️ Cloudflare Llama 3.1 8B (0.4s Super Fast)</option>
              <option value="gemini-2.5-pro">💎 Gemini 2.5 Pro (Google - Ultimate SEO Copywriting & Reasoning)</option>
              <option value="gemini-2.5-flash">⚡ Gemini 2.5 Flash (Google - Super Fast & Smart)</option>
              <option value="gemini-1.5-pro">💎 Gemini 1.5 Pro (Google - High Quality)</option>
              <option value="deepseek-v4-flash-free">🌟 DeepSeek V4 Flash (OpenCode - Ultra Fast & Stable)</option>
              <option value="minimax-m3">⚡ Minimax M3 (OpenCode - Ultra Fast & 100% Stable)</option>
              <option value="big-pickle">🥒 Big Pickle (OpenCode - SEO Reasoning, Very Slow - Requires 2 min)</option>
              <option value="nemotron-3-ultra-free">🚀 Nemotron 3 Ultra (OpenCode - Free)</option>
              <option value="north-mini-code-free">🧭 North Mini Code (OpenCode - Free)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">Vision AI Provider</label>
            <select
              value={visionProvider}
              onChange={(e) => setVisionProvider(e.target.value)}
              className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/30 font-medium text-slate-800"
            >
              <option value="cloudflare">☁️ Cloudflare Racing (Fast, Free & Rotated)</option>
              <option value="opencode">⚡ OpenCode Zen (MiniMax mimo-v2.5-free)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">OpenCode Zen API Key (Optional)</label>
            <input
              type="password"
              value={customApiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder="Leave blank to use server environment"
              className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/30"
            />
            <p className="text-[10px] text-muted mt-1.5">
              Saved locally in your browser. Leave blank if your local server already has the key configured in `.env` or system variables.
            </p>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">Gemini API Key (Optional)</label>
            <input
              type="password"
              value={customGeminiKey}
              onChange={(e) => handleGeminiKeyChange(e.target.value)}
              placeholder="Leave blank to use server .env key"
              className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/30"
            />
            <p className="text-[10px] text-muted mt-1.5">
              Used for visual analysis & direct copywriting. Get a free key in 10 seconds at <a href="https://aistudio.google.com/" target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline font-medium">Google AI Studio</a>.
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={isAnalyzing}
          className={`w-full py-4 px-6 rounded-2xl text-white font-semibold transition duration-200 flex items-center justify-center gap-2 shadow-sm ${
            isAnalyzing ? 'bg-slate-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/10'
          }`}
        >
          {isAnalyzing ? (
            <>
              <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Analyzing Content & Images...
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
              </svg>
              Analyze & Build Post
            </>
          )}
        </button>
      </div>
    </form>
  );
}
