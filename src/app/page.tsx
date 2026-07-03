'use client';

import React, { useState, useEffect } from 'react';
import Dashboard from '@/components/Dashboard';
import PostWizard from '@/components/PostWizard';
import { Project } from '@/lib/db';

export default function Home() {
  const [view, setView] = useState<'dashboard' | 'wizard'>('dashboard');
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch all projects on mount
  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      if (Array.isArray(data)) {
        setProjects(data);
      }
    } catch (e) {
      console.error("Failed to load projects:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreateNew = () => {
    setActiveProjectId(null);
    setView('wizard');
  };

  const handleSelectProject = (id: string) => {
    setActiveProjectId(id);
    setView('wizard');
  };

  const handleDeleteProject = async (id: string) => {
    try {
      const res = await fetch(`/api/projects?id=${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setProjects(prev => prev.filter(p => p.id !== id));
      } else {
        alert("Failed to delete project");
      }
    } catch (e) {
      console.error(e);
      alert("Error deleting project");
    }
  };

  const handleSaveProject = async (project: Project) => {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project),
      });
      if (res.ok) {
        fetchProjects(); // Reload list
      }
    } catch (e) {
      console.error("Error saving project:", e);
    }
  };

  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null;

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      {/* Header Banner */}
      <header className="bg-slate-900 text-white py-4 px-6 shadow-sm shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="bg-emerald-500 text-slate-900 font-extrabold px-2.5 py-1 rounded-lg text-sm tracking-wide shadow-sm">
              WP
            </span>
            <span className="font-extrabold text-base tracking-tight">Smart Poster</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>{process.env.NODE_ENV === 'production' ? 'Live' : 'Local Environment'}</span>
            <span className="h-1.5 w-1.5 bg-emerald-500 rounded-full animate-ping"></span>
          </div>
        </div>
      </header>


      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <svg className="animate-spin h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-sm font-medium text-slate-500">Loading your workspace...</span>
          </div>
        ) : view === 'dashboard' ? (
          <Dashboard
            projects={projects}
            onCreateNew={handleCreateNew}
            onSelectProject={handleSelectProject}
            onDeleteProject={handleDeleteProject}
          />
        ) : (
          <PostWizard
            initialProject={activeProject}
            onBackToDashboard={() => setView('dashboard')}
            onSaveProject={handleSaveProject}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 px-6 text-center text-xs text-slate-400 shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>WordPress Smart Poster v1.0.0</div>
          <div>Powered by OpenCode Zen gateway & Antigravity AI</div>
        </div>
      </footer>
    </div>
  );
}
