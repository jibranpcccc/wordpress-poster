import React, { useState } from 'react';
import { Project } from '@/lib/db';

interface DashboardProps {
  projects: Project[];
  onCreateNew: () => void;
  onSelectProject: (id: string) => void;
  onDeleteProject: (id: string) => void;
}

export default function Dashboard({ projects, onCreateNew, onSelectProject, onDeleteProject }: DashboardProps) {
  const [search, setSearch] = useState('');

  const filteredProjects = projects.filter((p) =>
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.mainKeyword.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: projects.length,
    completed: projects.filter((p) => p.status === 'completed').length,
    analyzing: projects.filter((p) => p.status === 'analyzing').length,
    drafts: projects.filter((p) => p.status === 'draft').length,
    errors: projects.filter((p) => p.status === 'error').length,
  };

  const getStatusBadge = (status: Project['status']) => {
    switch (status) {
      case 'completed':
        return <span className="px-2 py-1 text-xs font-semibold text-emerald-800 bg-emerald-100 rounded-full">Completed</span>;
      case 'analyzing':
        return <span className="px-2 py-1 text-xs font-semibold text-blue-800 bg-blue-100 rounded-full animate-pulse">Analyzing...</span>;
      case 'error':
        return <span className="px-2 py-1 text-xs font-semibold text-rose-800 bg-rose-100 rounded-full">Error</span>;
      case 'draft':
      default:
        return <span className="px-2 py-1 text-xs font-semibold text-slate-800 bg-slate-100 rounded-full">Draft</span>;
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Welcome header & CTA */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-6 rounded-2xl border border-card-border shadow-sm">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">WordPress Smart Poster</h1>
          <p className="text-sm text-muted mt-1">SEO-optimize your articles, match images visually, and export ready-to-publish posts.</p>
        </div>
        <button
          onClick={onCreateNew}
          className="flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover text-white font-medium px-5 py-3 rounded-xl transition duration-200 shadow-sm hover:shadow"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          Create New Post
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Total Projects', value: stats.total, color: 'text-slate-800 bg-slate-50 border-slate-100' },
          { label: 'Completed', value: stats.completed, color: 'text-emerald-700 bg-emerald-50/50 border-emerald-100' },
          { label: 'Analyzing', value: stats.analyzing, color: 'text-blue-700 bg-blue-50/50 border-blue-100' },
          { label: 'Drafts', value: stats.drafts, color: 'text-amber-700 bg-amber-50/50 border-amber-100' },
          { label: 'Errors', value: stats.errors, color: 'text-rose-700 bg-rose-50/50 border-rose-100' },
        ].map((stat, i) => (
          <div key={i} className={`p-4 rounded-xl border bg-white shadow-sm flex flex-col justify-between ${stat.color}`}>
            <span className="text-xs font-medium text-slate-500">{stat.label}</span>
            <span className="text-2xl font-bold mt-2">{stat.value}</span>
          </div>
        ))}
      </div>

      {/* Project list section */}
      <div className="bg-white rounded-2xl border border-card-border shadow-sm p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-slate-900">Recent Projects</h2>
          <div className="relative w-full sm:w-72">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              type="text"
              placeholder="Search by title or keyword..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/50"
            />
          </div>
        </div>

        {filteredProjects.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-slate-200 rounded-2xl bg-slate-50/30">
            <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="mt-4 text-sm font-semibold text-slate-900">No projects found</h3>
            <p className="mt-1 text-xs text-muted">
              {search ? 'Try adjusting your search terms.' : 'Get started by creating your first project!'}
            </p>
            {!search && (
              <button
                onClick={onCreateNew}
                className="mt-4 inline-flex items-center gap-2 bg-primary text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-primary-hover transition"
              >
                Create a project
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                className="group p-5 rounded-xl border border-slate-200 bg-white hover:border-primary/30 hover:shadow-md transition duration-200 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    {getStatusBadge(project.status)}
                    <span className="text-xs text-slate-400">{new Date(project.createdAt).toLocaleDateString()}</span>
                  </div>
                  <h3 className="font-bold text-slate-900 mt-3 group-hover:text-primary transition duration-150 line-clamp-1">
                    {project.title}
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <div>🔑 Keyword: <span className="font-semibold text-slate-700">{project.mainKeyword || 'None'}</span></div>
                    <div>🖼️ Images: <span className="font-semibold text-slate-700">{project.images?.length || 0}</span></div>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3">
                  <button
                    onClick={() => onSelectProject(project.id)}
                    className="text-xs font-semibold text-primary hover:text-primary-hover flex items-center gap-1"
                  >
                    Open Project
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Are you sure you want to delete "${project.title}"?`)) {
                        onDeleteProject(project.id);
                      }
                    }}
                    className="text-xs font-medium text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition"
                    title="Delete Project"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
