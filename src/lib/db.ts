import fs from 'fs';
import path from 'path';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

// Ensure local projects directory exists (fallback)
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Initialize Firebase Admin if environment variables are provided
let firestoreDb: any = null;
let isFirebaseInitialized = false;

function getFirebaseDb() {
  if (isFirebaseInitialized) return firestoreDb;

  const hasServiceAccount = !!process.env.FIREBASE_SERVICE_ACCOUNT;
  const hasIndividualKeys = !!(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL);

  if (hasServiceAccount || hasIndividualKeys) {
    try {
      if (getApps().length === 0) {
        let credential;
        if (hasServiceAccount) {
          console.log("[DB] Initializing Firebase Admin with FIREBASE_SERVICE_ACCOUNT JSON...");
          const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!);
          credential = cert(serviceAccount);
        } else {
          console.log("[DB] Initializing Firebase Admin with individual environment variables...");
          credential = cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
          });
        }

        initializeApp({
          credential,
        });
      }
      firestoreDb = getFirestore();
      isFirebaseInitialized = true;
      console.log("[DB] Firebase Firestore initialized successfully.");
      return firestoreDb;
    } catch (e) {
      console.error("[DB] Failed to initialize Firebase Admin:", e);
    }
  } else {
    console.log("[DB] Firebase credentials not found. Falling back to flat-file JSON database.");
  }
  return null;
}

export const db = {
  getProjects: async (): Promise<Project[]> => {
    const fDb = getFirebaseDb();
    if (fDb) {
      try {
        console.log("[DB] Fetching projects from Firestore...");
        const snapshot = await fDb.collection('projects').get();
        const projects: Project[] = [];
        snapshot.forEach((doc: any) => {
          projects.push(doc.data() as Project);
        });
        // Sort by creation date descending
        return projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      } catch (e) {
        console.error("[DB] Failed to fetch projects from Firestore:", e);
        // Fallback to local files if firestore fetch fails
      }
    }

    // Fallback to flat files
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
      return projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch (e) {
      console.error("Failed to read local projects:", e);
      return [];
    }
  },

  getProject: async (id: string): Promise<Project | null> => {
    const fDb = getFirebaseDb();
    if (fDb) {
      try {
        console.log(`[DB] Fetching project ${id} from Firestore...`);
        const doc = await fDb.collection('projects').doc(id).get();
        if (doc.exists) {
          return doc.data() as Project;
        }
        console.log(`[DB] Project ${id} not found in Firestore.`);
      } catch (e) {
        console.error(`[DB] Failed to fetch project ${id} from Firestore:`, e);
      }
    }

    // Fallback to flat files
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

  saveProject: async (project: Project): Promise<void> => {
    const fDb = getFirebaseDb();
    if (fDb) {
      try {
        console.log(`[DB] Saving project ${project.id} to Firestore...`);
        await fDb.collection('projects').doc(project.id).set(project, { merge: true });
        console.log(`[DB] Project ${project.id} saved to Firestore.`);
        return;
      } catch (e) {
        console.error(`[DB] Failed to save project ${project.id} to Firestore:`, e);
      }
    }

    // Fallback to flat files
    ensureDir();
    const filePath = path.join(DATA_DIR, `${project.id}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf8');
      console.log(`[DB] Project ${project.id} saved to local flat-file.`);
    } catch (e) {
      console.error(`Failed to save project ${project.id}:`, e);
      throw e;
    }
  },

  deleteProject: async (id: string): Promise<boolean> => {
    const fDb = getFirebaseDb();
    if (fDb) {
      try {
        console.log(`[DB] Deleting project ${id} from Firestore...`);
        await fDb.collection('projects').doc(id).delete();
        console.log(`[DB] Project ${id} deleted from Firestore.`);
        return true;
      } catch (e) {
        console.error(`[DB] Failed to delete project ${id} from Firestore:`, e);
      }
    }

    // Fallback to flat files
    ensureDir();
    const filePath = path.join(DATA_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) return false;
    try {
      fs.unlinkSync(filePath);
      console.log(`[DB] Project ${id} deleted from local flat-file.`);
      return true;
    } catch (e) {
      console.error(`Failed to delete project ${id}:`, e);
      return false;
    }
  },

  saveImage: async (id: string, base64Data: string, contentType: string): Promise<void> => {
    const fDb = getFirebaseDb();
    if (fDb) {
      try {
        console.log(`[DB] Saving image asset ${id} to Firestore...`);
        await fDb.collection('image_assets').doc(id).set({
          id,
          base64Data,
          contentType,
          createdAt: new Date().toISOString()
        });
        console.log(`[DB] Image asset ${id} saved to Firestore.`);
        return;
      } catch (e) {
        console.error(`[DB] Failed to save image asset ${id} to Firestore:`, e);
        throw e;
      }
    }
  },

  getImage: async (id: string): Promise<{ base64Data: string; contentType: string } | null> => {
    const fDb = getFirebaseDb();
    if (fDb) {
      try {
        console.log(`[DB] Fetching image asset ${id} from Firestore...`);
        const doc = await fDb.collection('image_assets').doc(id).get();
        if (doc.exists) {
          const data = doc.data();
          if (data) {
            return {
              base64Data: data.base64Data,
              contentType: data.contentType
            };
          }
        }
      } catch (e) {
        console.error(`[DB] Failed to fetch image asset ${id} from Firestore:`, e);
      }
    }
    return null;
  },

  deleteImage: async (id: string): Promise<boolean> => {
    const fDb = getFirebaseDb();
    if (fDb) {
      try {
        console.log(`[DB] Deleting image asset ${id} from Firestore...`);
        await fDb.collection('image_assets').doc(id).delete();
        return true;
      } catch (e) {
        console.error(`[DB] Failed to delete image asset ${id} from Firestore:`, e);
      }
    }
    return false;
  }
};
