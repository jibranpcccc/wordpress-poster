import React, { useState } from 'react';
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
  const [previewTab, setPreviewTab] = useState<'preview' | 'publish'>('preview');

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
  }) => {
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    setAnalysisStatus('Connecting to AI endpoint...');
    
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
      // Call Streaming API Endpoint
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: draftProject.id,
          articleContent: data.articleContent,
          mainKeyword: data.mainKeyword,
          relatedKeywords: data.relatedKeywords,
          images: draftProject.images,
          customApiKey: data.customApiKey,
          customGeminiKey: data.customGeminiKey,
          model: data.model,
          wpUrl: localStorage.getItem('wp_active_site_url') || localStorage.getItem('wp_site_url') || ''
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("Could not initialize chunk reader.");
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let ai = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // retain the last partial line

        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const parsed = JSON.parse(line.trim());
            if (parsed.type === 'progress') {
              setAnalysisProgress(parsed.progress);
              setAnalysisStatus(parsed.message);
            } else if (parsed.type === 'success') {
              ai = parsed.data;
            } else if (parsed.type === 'error') {
              throw new Error(parsed.error);
            }
          } catch (jsonErr: any) {
            // Ignore parse errors on incomplete chunks
            console.warn("Stream JSON parse warning:", jsonErr);
          }
        }
      }

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

        setProject(completedProject);
        onSaveProject(completedProject);
        setStep(3); // Advance to matching
      } else {
        throw new Error('AI returned an empty response during analysis.');
      }
    } catch (e: any) {
      console.error(e);
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
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-slate-100 transform transition-all animate-fade-in">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 mb-4 animate-bounce">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-slate-800">WordPress Smart Post Builder</h3>
              <p className="text-sm text-slate-500 mt-1">Generating your SEO optimized post</p>
            </div>

            {/* Progress Bar Container */}
            <div className="w-full bg-slate-100 rounded-full h-3 mb-4 overflow-hidden relative">
              <div 
                className="bg-emerald-600 h-full rounded-full transition-all duration-500 ease-out shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                style={{ width: `${analysisProgress}%` }}
              />
            </div>

            <div className="flex justify-between items-center mb-6">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Current Stage</span>
              <span className="text-sm font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full">{analysisProgress}%</span>
            </div>

            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 min-h-[70px] flex items-center justify-center text-center">
              <p className="text-sm font-medium text-slate-600 leading-relaxed animate-pulse">
                {analysisStatus || "Initializing post analysis..."}
              </p>
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
            <div className="flex justify-between border-t border-slate-100 pt-6">
              <button
                onClick={() => setStep(2)}
                className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition"
              >
                Back to Configure Post
              </button>
              <button
                onClick={() => setStep(4)}
                className="px-6 py-2.5 bg-primary hover:bg-primary-hover text-white text-xs font-semibold rounded-lg transition shadow-sm"
              >
                Continue to Preview & Publish
              </button>
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
