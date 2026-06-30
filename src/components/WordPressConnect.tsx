import React, { useState, useEffect } from 'react';

interface Category {
  id: number;
  name: string;
  slug: string;
}

interface SavedSite {
  siteUrl: string;
  username: string;
  password: string;
  categories?: Category[];
  selectedCategoryIds?: number[];
}

interface WordPressConnectProps {
  selectedCategoryIds: number[];
  onSelectCategories: (ids: number[]) => void;
  onNext: () => void;
}

export default function WordPressConnect({ selectedCategoryIds, onSelectCategories, onNext }: WordPressConnectProps) {
  const [savedSites, setSavedSites] = useState<SavedSite[]>([]);
  const [selectedSiteIndex, setSelectedSiteIndex] = useState<number | 'new'>('new');
  
  const [wpUrl, setWpUrl] = useState('');
  const [wpUser, setWpUser] = useState('');
  const [wpPassword, setWpPassword] = useState('');
  
  const [isTesting, setIsTesting] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // 1. Load saved sites on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedSitesJson = localStorage.getItem('wp_saved_sites');
      let sites: SavedSite[] = [];
      
      if (storedSitesJson) {
        try {
          sites = JSON.parse(storedSitesJson);
          setSavedSites(sites);
        } catch (e) {
          console.error("Failed to parse saved sites", e);
        }
      }

      const activeSiteUrl = localStorage.getItem('wp_active_site_url') || '';
      const activeUsername = localStorage.getItem('wp_active_username') || '';

      if (sites.length > 0) {
        const foundIdx = sites.findIndex(s => s.siteUrl === activeSiteUrl && s.username === activeUsername);
        const targetIdx = foundIdx !== -1 ? foundIdx : 0;
        
        setSelectedSiteIndex(targetIdx);
        const site = sites[targetIdx];
        setWpUrl(site.siteUrl);
        setWpUser(site.username);
        setWpPassword(site.password);
        
        // Load cached categories immediately for instant UI
        if (site.categories && site.categories.length > 0) {
          setCategories(site.categories);
        }
        if (site.selectedCategoryIds) {
          onSelectCategories(site.selectedCategoryIds);
        }

        // Refresh categories in background
        testConnection(site.siteUrl, site.username, site.password, sites, targetIdx);
      }
    }
  }, []);

  // 2. Test connection and load categories (caches results on success)
  const testConnection = async (
    url: string = wpUrl,
    user: string = wpUser,
    pass: string = wpPassword,
    currentSites: SavedSite[] = savedSites,
    forcedIndex?: number
  ) => {
    if (!url.trim()) return;
    setIsTesting(true);
    setStatus(null);

    try {
      const res = await fetch('/api/wordpress/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl: url, username: user, password: pass })
      });

      const resText = await res.text();
      let data;
      try {
        data = JSON.parse(resText);
      } catch (jsonErr) {
        setStatus({ 
          type: 'error', 
          message: `Server returned an invalid response (Status ${res.status}). Please make sure your WordPress URL starts with http:// or https:// and is spelled correctly.` 
        });
        return;
      }

      if (data && data.success && Array.isArray(data.categories)) {
        setCategories(data.categories);
        setStatus({ type: 'success', message: `Connected successfully! Loaded ${data.categories.length} categories.` });
        
        // Update saved sites array
        const updatedSites = [...currentSites];
        const existingIdx = updatedSites.findIndex(s => s.siteUrl === url && s.username === user);
        
        if (existingIdx !== -1) {
          updatedSites[existingIdx].password = pass;
          updatedSites[existingIdx].categories = data.categories;
          // Keep existing selections if none saved yet
          if (!updatedSites[existingIdx].selectedCategoryIds) {
            updatedSites[existingIdx].selectedCategoryIds = selectedCategoryIds;
          }
        } else {
          updatedSites.push({
            siteUrl: url,
            username: user,
            password: pass,
            categories: data.categories,
            selectedCategoryIds: selectedCategoryIds
          });
        }
        
        setSavedSites(updatedSites);
        localStorage.setItem('wp_saved_sites', JSON.stringify(updatedSites));
        localStorage.setItem('wp_active_site_url', url);
        localStorage.setItem('wp_active_username', user);
        
        const newIdx = forcedIndex !== undefined ? forcedIndex : updatedSites.findIndex(s => s.siteUrl === url && s.username === user);
        setSelectedSiteIndex(newIdx !== -1 ? newIdx : 0);
      } else {
        setStatus({ type: 'error', message: (data && data.error) || 'Connection failed. Please check your credentials.' });
      }
    } catch (e: any) {
      setStatus({ type: 'error', message: e.message || 'Network error occurred while connecting.' });
    } finally {
      setIsTesting(false);
    }
  };

  // 3. Handle selecting a saved site
  const handleSelectSite = (val: string) => {
    if (val === 'new') {
      setSelectedSiteIndex('new');
      setWpUrl('');
      setWpUser('');
      setWpPassword('');
      setCategories([]);
      onSelectCategories([]);
      setStatus(null);
    } else {
      const idx = parseInt(val, 10);
      setSelectedSiteIndex(idx);
      const site = savedSites[idx];
      setWpUrl(site.siteUrl);
      setWpUser(site.username);
      setWpPassword(site.password);
      
      // Instant UI update from cache
      if (site.categories && site.categories.length > 0) {
        setCategories(site.categories);
      } else {
        setCategories([]);
      }

      if (site.selectedCategoryIds) {
        onSelectCategories(site.selectedCategoryIds);
      } else {
        onSelectCategories([]);
      }
      
      testConnection(site.siteUrl, site.username, site.password, savedSites, idx);
    }
  };

  // 4. Remove a saved site
  const handleRemoveSite = (index: number) => {
    const updated = savedSites.filter((_, i) => i !== index);
    setSavedSites(updated);
    localStorage.setItem('wp_saved_sites', JSON.stringify(updated));
    
    if (selectedSiteIndex === index) {
      handleSelectSite('new');
    } else if (typeof selectedSiteIndex === 'number' && selectedSiteIndex > index) {
      setSelectedSiteIndex(selectedSiteIndex - 1);
    }
  };

  // 5. Checkbox selection updates the current site settings
  const handleCheckboxChange = (catId: number) => {
    let newIds = [];
    if (selectedCategoryIds.includes(catId)) {
      newIds = selectedCategoryIds.filter(id => id !== catId);
    } else {
      newIds = [...selectedCategoryIds, catId];
    }
    
    onSelectCategories(newIds);

    // Save selection inside savedSites array
    if (typeof selectedSiteIndex === 'number') {
      const updated = [...savedSites];
      updated[selectedSiteIndex].selectedCategoryIds = newIds;
      setSavedSites(updated);
      localStorage.setItem('wp_saved_sites', JSON.stringify(updated));
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white p-8 rounded-2xl border border-card-border shadow-sm space-y-6 animate-fadeIn">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Step 1: Connect to WordPress</h2>
          <p className="text-sm text-muted mt-1">Select a saved site or enter your credentials. Categories are fetched dynamically and cached for high speed.</p>
        </div>
      </div>

      {/* Website Dropdown Selector */}
      <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl space-y-3">
        <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">Choose Connected Website</label>
        <div className="flex gap-2">
          <select
            value={selectedSiteIndex.toString()}
            onChange={(e) => handleSelectSite(e.target.value)}
            className="flex-1 px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white font-medium text-slate-800"
          >
            <option value="new">➕ Add New Website...</option>
            {savedSites.map((site, idx) => (
              <option key={idx} value={idx}>
                🌐 {site.siteUrl.replace(/^https?:\/\//, '')} ({site.username})
              </option>
            ))}
          </select>

          {typeof selectedSiteIndex === 'number' && (
            <button
              type="button"
              onClick={() => handleRemoveSite(selectedSiteIndex)}
              className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-bold rounded-xl transition flex items-center justify-center"
              title="Delete site connection details"
            >
              🗑️ Delete
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">WordPress Site URL *</label>
          <input
            type="url"
            required
            value={wpUrl}
            onChange={(e) => {
              setWpUrl(e.target.value);
              setSelectedSiteIndex('new');
            }}
            placeholder="https://tresscribe.com"
            className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/30"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5 font-sans">WP Username *</label>
            <input
              type="text"
              required
              value={wpUser}
              onChange={(e) => {
                setWpUser(e.target.value);
                setSelectedSiteIndex('new');
              }}
              placeholder="e.g. admin"
              className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/30"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1.5">WP Application Password *</label>
            <input
              type="password"
              required
              value={wpPassword}
              onChange={(e) => {
                setWpPassword(e.target.value);
                setSelectedSiteIndex('new');
              }}
              placeholder="xxxx xxxx xxxx xxxx xxxx"
              className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50/30"
            />
          </div>
        </div>

        <button
          type="button"
          disabled={isTesting}
          onClick={() => testConnection(wpUrl, wpUser, wpPassword)}
          className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition duration-150 flex items-center justify-center gap-2"
        >
          {isTesting ? (
            <>
              <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Connecting & refreshing...
            </>
          ) : 'Connect & Fetch Categories'}
        </button>

        {status && (
          <div className={`p-4 rounded-xl text-xs leading-normal border ${
            status.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-rose-50 text-rose-800 border-rose-100'
          }`}>
            {status.message}
          </div>
        )}
      </div>

      {categories.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-slate-100">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">Select Categories (Select one or more):</label>
          <div className="grid grid-cols-2 gap-3 max-h-48 overflow-y-auto p-1 border border-slate-100 rounded-xl bg-slate-50/50">
            {categories.map((cat) => (
              <label
                key={cat.id}
                className="flex items-center gap-2 text-xs text-slate-700 font-semibold p-2 bg-white rounded-lg border border-slate-200/60 cursor-pointer select-none hover:border-primary/30"
              >
                <input
                  type="checkbox"
                  checked={selectedCategoryIds.includes(cat.id)}
                  onChange={() => handleCheckboxChange(cat.id)}
                  className="h-4 w-4 text-primary focus:ring-primary border-slate-300 rounded"
                />
                {cat.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end pt-4 border-t border-slate-100">
        <button
          type="button"
          disabled={categories.length === 0}
          onClick={onNext}
          className={`px-6 py-3 text-xs font-semibold rounded-xl text-white transition flex items-center gap-1 ${
            categories.length === 0 ? 'bg-slate-300 cursor-not-allowed' : 'bg-primary hover:bg-primary-hover shadow-sm'
          }`}
        >
          Continue to Post Setup
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
