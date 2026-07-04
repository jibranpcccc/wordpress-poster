import React, { useState, useEffect, useRef } from 'react';
import { Project, ImageDetail, SEOData } from '@/lib/db';
import WordPressConnect from './WordPressConnect';
import NewPostForm from './NewPostForm';
import ImageManager from './ImageManager';
import LivePreview from './LivePreview';
import OutputViewer from './OutputViewer';

interface PostWizardProps {
  initialProject?: Project | null;
  onBackToDashboard: () => void;
  onSaveProject: (project: Project) => void;
}

type Step = 1 | 2 | 3 | 4;

const steps = [
  { num: 1, label: 'WordPress Connect' },
  { num: 2, label: 'Configure Post' },
  { num: 3, label: 'Match Images' },
  { num: 4, label: 'Preview & Publish' },
];

export default function PostWizard({ initialProject, onBackToDashboard, onSaveProject }: PostWizardProps) {
  const [project, setProject] = useState<Project>(
    initialProject || {
      id: `proj_${Date.now()}`,
      title: '',
      articleContent: '',
      mainKeyword: '',
      relatedKeywords: '',
      category: '',
      tags: '',
      status: 'draft',
      createdAt: new Date().toISOString(),
      images: [],
      selectedCategoryIds: []
    }
  );

  const [step, setStep] = useState<Step>(
    project.status === 'completed' ? 3 : 1
  );
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisStatus, setAnalysisStatus] = useState('');
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const [previewTab, setPreviewTab] = useState<'preview' | 'publish'>('preview');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Timer to count elapsed seconds during AI Analysis
  useEffect(() => {
    let intervalId: any = null;
    if (isAnalyzing) {
      setElapsedSeconds(0);
      intervalId = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (intervalId) clearInterval(intervalId);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isAnalyzing]);

  // Auto scroll console to bottom
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [consoleLogs]);

  const addLog = (message: string) => {
    const time = new Date().toLocaleTimeString();
    setConsoleLogs(prev => [...prev, `[${time}] ${message}`]);
  };

  const paragraphs = (project.formattedContent || project.articleContent)
    .split('\n')
    .map(p => p.trim())
    .filter(p => p.length > 0);

  // Step 1: Select categories
  const handleSelectCategories = (ids: number[]) => {
    const updatedProject = { ...project, selectedCategoryIds: ids };
    setProject(updatedProject);
    onSaveProject(updatedProject);
  };

  // Step 2 -> Step 3: Trigger AI Analysis (Streaming Progress)
  const handleAnalyze = async (data: {
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
  }) => {
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisStatus('Connecting to AI endpoint...');
    setConsoleLogs([]);
    addLog("INFO: Starting WordPress Smart Post Builder analysis flow...");
    
    // Save draft state first
    const draftProject: Project = {
      ...project,
      title: data.title,
      articleContent: data.articleContent,
      mainKeyword: data.mainKeyword,
      relatedKeywords: data.relatedKeywords,
      category: data.category,
      tags: data.tags,
      status: 'analyzing',
      images: data.images.map((img, i) => ({
        id: `img_${i}_${Date.now()}`,
        originalName: img.originalName,
        localPath: img.localPath,
        seoFilename: img.originalName,
        altText: '',
        caption: '',
        isFeatured: false,
        doNotUse: false,
        placement: `after paragraph ${i}`,
        notes: '',
        wpMediaId: img.wpMediaId
      }))
    };
    
    setProject(draftProject);
    onSaveProject(draftProject);

    try {
      setAnalysisProgress(5);
      setAnalysisStatus("Initializing analysis flow...");
      addLog("INFO: Saved project draft state to database.");

      const totalImages = draftProject.images.length;
      let visionResults: any[] = [];

      if (totalImages > 0) {
        setAnalysisStatus(`Analyzing ${totalImages} image(s)...`);
        addLog(`VISION: Describing hair in ${totalImages} image(s) in fast chunks of 10 using LLava vision...`);
        let completed = 0;
        const images = draftProject.images;
        const chunkSize = 10;
        visionResults = new Array(totalImages);

        for (let i = 0; i < images.length; i += chunkSize) {
          const chunk = images.slice(i, i + chunkSize);
          const chunkPromises = chunk.map(async (img, chunkIdx) => {
            const index = i + chunkIdx;
            try {
              const res = await fetch('/api/analyze/vision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  image: img,
                  mainKeyword: data.mainKeyword,
                  customGeminiKey: data.customGeminiKey,
                  customApiKey: data.customApiKey,
                  visionProvider: data.visionProvider
                })
              });
              
              if (!res.ok) {
                throw new Error(`Vision API error ${res.status}`);
              }
              
              const parsed = await res.json();
              completed++;
              const percent = Math.round(5 + (completed / totalImages) * 45); // up to 50%
              setAnalysisProgress(percent);
              setAnalysisStatus(`Described ${completed} of ${totalImages} image(s)...`);
              addLog(`VISION: Image "${img.originalName}" described: ${(parsed.visualDescription || '').substring(0, 60)}...`);
              visionResults[index] = parsed;
            } catch (err: any) {
              console.warn(`Vision failed for image ${img.originalName}, using fallback:`, err);
              completed++;
              addLog(`WARNING: Vision failed for "${img.originalName}". Using filename-based fallback.`);
              const cleanStem = img.originalName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').replace(/\d{10,}/g, '').trim();
              visionResults[index] = {
                id: img.id,
                originalName: img.originalName,
                visualDescription: `Hair style shown in ${cleanStem || 'uploaded image'}.`,
                seoFilename: '',
                altText: '',
                caption: ''
              };
            }
          });
          await Promise.all(chunkPromises);
        }
      } else {
        setAnalysisProgress(50);
        addLog("INFO: No images uploaded. Skipping visual analysis phase.");
      }

      // Phase 2: Copywriting
      setAnalysisProgress(60);
      setAnalysisStatus("Generating post copy, layout & formatting...");
      addLog(`COPYWRITING: Starting copywriting and formatting phase using model: "${data.model}"...`);

      const copywriterRes = await fetch('/api/analyze/copywriter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleContent: data.articleContent,
          mainKeyword: data.mainKeyword,
          relatedKeywords: data.relatedKeywords,
          visionResults: visionResults,
          customApiKey: data.customApiKey,
          customGeminiKey: data.customGeminiKey,
          selectedModel: data.model,
          wpUrl: localStorage.getItem('wp_active_site_url') || localStorage.getItem('wp_site_url') || ''
        })
      });

      if (!copywriterRes.ok) {
        const errData = await copywriterRes.json().catch(() => ({}));
        throw new Error(errData.error || `Copywriter API error ${copywriterRes.status}`);
      }

      const reader = copywriterRes.body?.getReader();
      if (!reader) {
        throw new Error("Could not initialize copywriter chunk reader.");
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let ai = null;
      let serverError: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // retain the last partial line

        for (const line of lines) {
          if (!line.trim()) {
            if (line === ' ') {
              addLog("HEARTBEAT: Connection kept alive by server.");
            }
            continue;
          }
          
          try {
            const parsed = JSON.parse(line.trim());
            if (parsed.type === 'progress') {
              setAnalysisProgress(parsed.progress);
              setAnalysisStatus(parsed.message);
              addLog(`PROGRESS: ${parsed.message} (${parsed.progress}%)`);
            } else if (parsed.type === 'success') {
              ai = parsed.data;
              addLog("SUCCESS: Copywriter model returned structured post JSON.");
            } else if (parsed.type === 'error') {
              serverError = parsed.error;
              addLog(`ERROR: Copywriter endpoint error: ${parsed.error}`);
            }
          } catch (jsonErr: any) {
            // Ignore parse warnings on heartbeats
          }
        }
      }

      if (serverError) {
        throw new Error(serverError);
      }

      setAnalysisProgress(95);
      setAnalysisStatus("Wrapping up SEO mapping...");
      addLog("INFO: Distributing images and merging AI metadata...");

      if (ai) {
        // Merge AI analysis results back into images
        const updatedImages = draftProject.images.map(img => {
          const match = ai.imageMatches?.find((m: any) => m.originalName === img.originalName || m.id === img.id);
          if (match) {
            return {
              ...img,
              seoFilename: match.seoFilename || img.seoFilename,
              altText: match.altText || '',
              caption: match.caption || '',
              placement: match.placementParagraphIndex !== undefined 
                ? `after paragraph ${match.placementParagraphIndex}`
                : img.placement,
              isFeatured: ai.featuredImageId === img.id || (match.useImage && ai.featuredImageId === match.originalName),
              doNotUse: match.useImage === false,
              notes: match.reasonNotUsed || match.notes || ''
            };
          }
          return img;
        });

        // If no featured image was selected by AI, make the first active image featured
        const hasFeatured = updatedImages.some(img => img.isFeatured);
        if (!hasFeatured && updatedImages.length > 0) {
          const firstActive = updatedImages.find(img => !img.doNotUse);
          if (firstActive) firstActive.isFeatured = true;
        }

        const completedProject: Project = {
          ...draftProject,
          title: ai.seoTitle || draftProject.title,
          status: 'completed',
          images: updatedImages,
          formattedContent: ai.formattedArticleContent || data.articleContent,
          seoData: {
            seoTitle: ai.seoTitle || data.title,
            metaDescription: ai.metaDescription || '',
            slug: ai.slug || (ai.seoTitle || data.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
            focusKeyword: ai.focusKeyword || data.mainKeyword,
            relatedKeywords: ai.relatedKeywords || (data.relatedKeywords ? data.relatedKeywords.split(',').map(s => s.trim()) : []),
            pinterestTitle: ai.pinterestTitle || '',
            pinterestDescription: ai.pinterestDescription || '',
          }
        };

        setAnalysisProgress(100);
        setProject(completedProject);
        onSaveProject(completedProject);
        addLog("SUCCESS: SEO structure and formatted paragraphs updated successfully!");
        setStep(3); // Advance to matching
      } else {
        throw new Error('AI returned an empty response during analysis.');
      }
    } catch (e: any) {
      console.error(e);
      addLog(`ERROR: Analysis failed: ${e.message}`);
      const errorProject: Project = {
        ...draftProject,
        status: 'error',
        errorMessage: e.message || 'Unknown analysis error'
      };
      setProject(errorProject);
      onSaveProject(errorProject);
      alert(`AI Analysis Failed: ${e.message || 'Please check your connection and try again.'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Update a single image's fields
  const handleUpdateImage = (id: string, updatedFields: Partial<ImageDetail>) => {
    const updatedImages = project.images.map(img => 
      img.id === id ? { ...img, ...updatedFields } : img
    );
    const updatedProject = { ...project, images: updatedImages };
    setProject(updatedProject);
    onSaveProject(updatedProject);
  };

  // Update SEO Meta
  const handleUpdateSEO = (updatedFields: Partial<SEOData>) => {
    if (!project.seoData) return;
    const updatedProject = {
      ...project,
      seoData: { ...project.seoData, ...updatedFields }
    };
    setProject(updatedProject);
    onSaveProject(updatedProject);
  };

  // Update full project (e.g. settings)
  const handleUpdateFullProject = (updatedProject: Project) => {
    setProject(updatedProject);
    onSaveProject(updatedProject);
  };

  return (
    <div className="space-y-6">
      {isAnalyzing && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-slate-900 text-white rounded-3xl p-8 max-w-lg w-full shadow-2xl border border-slate-800/80 transform transition-all">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-400 mb-4 animate-pulse">
                <svg className="w-8 h-8 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-slate-100">WordPress Smart Post Builder</h3>
              <p className="text-sm text-slate-400 mt-1">Generating your SEO optimized post</p>
            </div>

            {/* Progress Bar Container */}
            <div className="w-full bg-slate-800 rounded-full h-3 mb-4 overflow-hidden relative border border-slate-700/50">
              <div 
                className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-500 ease-out shadow-[0_0_12px_rgba(16,185,129,0.6)]"
                style={{ width: `${analysisProgress}%` }}
              />
            </div>

            <div className="flex justify-between items-center mb-4">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Current Stage</span>
              <span className="text-sm font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">{analysisProgress}%</span>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 min-h-[70px] flex flex-col items-center justify-center text-center mb-4 backdrop-blur-sm">
              <p className="text-sm font-medium text-slate-300 leading-relaxed">
                {analysisStatus || "Initializing post analysis..."}
              </p>
              {isAnalyzing && (
                <p className="text-xs text-amber-400 font-mono mt-2 animate-pulse">
                  Elapsed Time: {elapsedSeconds}s {elapsedSeconds > 25 ? '— OpenCode reasoning models can take up to 2 minutes' : ''}
                </p>
              )}
            </div>

            {/* Live Console Container */}
            <div className="space-y-2 text-left">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Live System Console</span>
              <div className="bg-slate-950 rounded-2xl p-4 font-mono text-[11px] text-slate-300 border border-slate-800/80 h-44 overflow-y-auto space-y-1.5 shadow-inner scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                {consoleLogs.length === 0 ? (
                  <div className="text-slate-500 italic">[Waiting for log output...]</div>
                ) : (
                  consoleLogs.map((log, idx) => {
                    let logClass = 'text-slate-400';
                    if (log.includes('ERROR:')) logClass = 'text-rose-400 font-bold';
                    else if (log.includes('SUCCESS:')) logClass = 'text-emerald-400 font-bold';
                    else if (log.includes('HEARTBEAT:')) logClass = 'text-cyan-400/85';
                    else if (log.includes('VISION:')) logClass = 'text-indigo-400';
                    else if (log.includes('PROGRESS:')) logClass = 'text-amber-400/90';

                    return (
                      <div key={idx} className={`${logClass} break-all leading-normal`}>
                        {log}
                      </div>
                    );
                  })
                )}
                <div ref={consoleEndRef} />
              </div>
            </div>
            
            <div className="mt-4 pt-4 border-t border-slate-800/80 flex justify-center">
              <a 
                href="/api/debug-log" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition font-medium"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                View full server debug log
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Wizard Header bar */}
      <div className="flex items-center justify-between gap-4 bg-white px-6 py-4 rounded-xl border border-card-border shadow-sm">
        <button
          onClick={onBackToDashboard}
          className="text-xs font-semibold text-slate-500 hover:text-slate-900 flex items-center gap-1 transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </button>
        <span className="text-sm font-bold text-slate-900 truncate">{project.title || 'New Post'}</span>
      </div>

      {/* Step Indicators */}
      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-card-border shadow-sm">
        {steps.map((s) => (
          <div
            key={s.num}
            className={`flex-1 flex flex-col sm:flex-row items-center justify-center gap-1.5 sm:gap-2 text-center ${
              step === s.num ? 'text-primary' : step > s.num ? 'text-emerald-600' : 'text-slate-400'
            }`}
          >
            <span className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
              step === s.num 
                ? 'bg-primary text-white' 
                : step > s.num 
                  ? 'bg-emerald-100 text-emerald-800' 
                  : 'bg-slate-100 text-slate-500'
            }`}>
              {step > s.num ? '✓' : s.num}
            </span>
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Steps Content Area */}
      <div className="min-h-[400px]">
        {step === 1 && (
          <WordPressConnect 
            selectedCategoryIds={project.selectedCategoryIds || []}
            onSelectCategories={handleSelectCategories}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <div className="space-y-6">
            <NewPostForm onAnalyze={handleAnalyze} isAnalyzing={isAnalyzing} />
            <div className="flex justify-start border-t border-slate-100 pt-6">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition"
              >
                Back to WordPress Connect
              </button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-6">
            <ImageManager 
              images={project.images} 
              onUpdateImage={handleUpdateImage} 
              paragraphsCount={paragraphs.length} 
            />
            <div className="flex justify-between items-center border-t border-slate-100 pt-6">
              <button
                onClick={() => setStep(2)}
                className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition"
              >
                Back to Configure Post
              </button>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    if (confirm('Re-analyze will regenerate all SEO data, alt text, and image placements using the AI. Continue?')) {
                      setStep(2);
                    }
                  }}
                  className="px-5 py-2.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-semibold rounded-lg transition flex items-center gap-1.5"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Re-Analyze SEO & Images
                </button>
                <button
                  onClick={() => setStep(4)}
                  className="px-6 py-2.5 bg-primary hover:bg-primary-hover text-white text-xs font-semibold rounded-lg transition shadow-sm"
                >
                  Continue to Preview & Publish
                </button>
              </div>
            </div>
          </div>
        )}
        {step === 4 && (
          <div className="space-y-6">
            <div className="flex border-b border-slate-200 bg-white p-2 rounded-xl border border-card-border shadow-sm gap-2">
              <button
                onClick={() => setPreviewTab('preview')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition ${
                  previewTab === 'preview' 
                    ? 'bg-primary text-white shadow-sm' 
                    : 'bg-transparent text-slate-600 hover:bg-slate-50'
                }`}
              >
                🔍 Gutenberg Live Preview
              </button>
              <button
                onClick={() => setPreviewTab('publish')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition ${
                  previewTab === 'publish' 
                    ? 'bg-primary text-white shadow-sm' 
                    : 'bg-transparent text-slate-600 hover:bg-slate-50'
                }`}
              >
                🚀 Publish & Export Tools
              </button>
            </div>

            {previewTab === 'preview' ? (
              project.seoData && (
                <LivePreview 
                  articleContent={project.formattedContent || project.articleContent} 
                  images={project.images} 
                  seoData={project.seoData} 
                  onUpdateSEO={handleUpdateSEO} 
                />
              )
            ) : (
              <OutputViewer project={project} onUpdateProject={handleUpdateFullProject} />
            )}

            <div className="flex justify-start border-t border-slate-100 pt-6">
              <button
                onClick={() => setStep(3)}
                className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition"
              >
                Back to Match Images
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
