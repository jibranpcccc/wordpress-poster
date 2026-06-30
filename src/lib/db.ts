import fs from 'fs';
import path from 'path';

export interface ImageDetail {
  id: string;
  originalName: string;
  localPath: string; // public/uploads/...
  seoFilename: string;
  altText: string;
  caption: string;
  isFeatured: boolean;
  doNotUse: boolean;
  placement: string; // e.g. "after paragraph 3"
  notes: string;
}

export interface SEOData {
  seoTitle: string;
  metaDescription: string;
  slug: string;
  focusKeyword: string;
  relatedKeywords: string[];
  pinterestTitle?: string;
  pinterestDescription?: string;
}

export interface Project {
  id: string;
  title: string;
  articleContent: string;
  formattedContent?: string;
  mainKeyword: string;
  relatedKeywords: string;
  category: string;
  tags: string;
  status: 'draft' | 'analyzing' | 'completed' | 'error';
  createdAt: string;
  images: ImageDetail[];
  seoData?: SEOData;
  wordpressPost?: string; // post content with embedded images
  errorMessage?: string;
  selectedCategoryIds?: number[];
  wpSettings?: {
    siteUrl: string;
    username: string;
    hasPassword?: boolean;
  };
}

const DATA_DIR = path.join(process.cwd(), 'src', 'data', 'projects');

// Ensure projects directory exists
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export const db = {
  getProjects: (): Project[] => {
    ensureDir();
    try {
      const files = fs.readdirSync(DATA_DIR);
      const projects: Project[] = [];
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
            projects.push(JSON.parse(content));
          } catch (e) {
            console.error(`Failed to parse project file ${file}:`, e);
          }
        }
      }
      // Sort by creation date descending
      return projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (e) {
      console.error("Failed to read projects:", e);
      return [];
    }
  },

  getProject: (id: string): Project | null => {
    ensureDir();
    const filePath = path.join(DATA_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      console.error(`Failed to read project ${id}:`, e);
      return null;
    }
  },

  saveProject: (project: Project): void => {
    ensureDir();
    const filePath = path.join(DATA_DIR, `${project.id}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf8');
    } catch (e) {
      console.error(`Failed to save project ${project.id}:`, e);
      throw e;
    }
  },

  deleteProject: (id: string): boolean => {
    ensureDir();
    const filePath = path.join(DATA_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) return false;
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (e) {
      console.error(`Failed to delete project ${id}:`, e);
      return false;
    }
  }
};
