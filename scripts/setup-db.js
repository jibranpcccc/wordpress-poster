/**
 * Firebase Firestore Test & Setup Helper Script
 * 
 * This script verifies your Firebase configuration and creates/verifies 
 * the 'projects' collection.
 * 
 * Run it with: node scripts/setup-db.js
 */

const fs = require('fs');
const path = require('path');

// 1. Manually load environment variables from .env or .env.local if present
function loadEnv() {
  const envPaths = [
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '.env')
  ];
  
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      console.log(`[Setup] Loading environment variables from: ${envPath}`);
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const partIndex = trimmed.indexOf('=');
          const key = trimmed.slice(0, partIndex).trim();
          let val = trimmed.slice(partIndex + 1).trim();
          
          // Strip surrounding quotes
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          
          process.env[key] = val;
        }
      });
      break;
    }
  }
}

loadEnv();

const hasServiceAccount = !!process.env.FIREBASE_SERVICE_ACCOUNT;
const hasIndividualKeys = !!(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL);

if (!hasServiceAccount && !hasIndividualKeys) {
  console.error("\n[Error] No Firebase credentials found in environment variables!");
  console.error("Please make sure you have either:");
  console.error(" - FIREBASE_SERVICE_ACCOUNT (pasted service account JSON string)");
  console.error(" OR");
  console.error(" - FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY");
  console.error("\nCheck the README.md or implementation_plan.md for instructions on how to obtain these.\n");
  process.exit(1);
}

try {
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');

  console.log("[Setup] Connecting to Firebase Firestore...");
  
  let credential;
  if (hasServiceAccount) {
    console.log("[Setup] Using FIREBASE_SERVICE_ACCOUNT JSON...");
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    credential = cert(serviceAccount);
  } else {
    console.log("[Setup] Using individual credentials (project_id, client_email)...");
    credential = cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    });
  }

  if (getApps().length === 0) {
    initializeApp({ credential });
  }

  const db = getFirestore();
  
  async function runSetup() {
    console.log("[Setup] Writing test document to 'projects' collection...");
    
    const testDocId = 'test_connection_doc';
    const testData = {
      id: testDocId,
      title: 'Database Connection Test',
      articleContent: 'This is a test article to verify Firebase setup.',
      mainKeyword: 'test',
      relatedKeywords: 'test connection, firebase',
      category: 'Test',
      tags: 'test',
      status: 'completed',
      createdAt: new Date().toISOString(),
      images: []
    };

    // Save test document
    await db.collection('projects').doc(testDocId).set(testData);
    console.log("[Setup] Test document successfully written!");

    // Read back test document
    const doc = await db.collection('projects').doc(testDocId).get();
    if (doc.exists && doc.data().title === testData.title) {
      console.log("[Setup] Verification reading successful!");
    } else {
      throw new Error("Failed to verify document content matches what was written");
    }

    // Delete test document
    await db.collection('projects').doc(testDocId).delete();
    console.log("[Setup] Test document successfully cleaned up.");
    
    console.log("\n========================================================");
    console.log(" SUCCESS! Firebase Firestore is configured correctly!");
    console.log(" Your cloud database is ready for Wordpress Poster.");
    console.log("========================================================\n");
  }

  runSetup().catch(err => {
    console.error("\n[Error] Setup failed during database operations:", err);
    process.exit(1);
  });

} catch (err) {
  console.error("\n[Error] Failed to initialize Firebase module or parse credentials:", err);
  console.error("Make sure firebase-admin is installed: npm install firebase-admin");
  process.exit(1);
}
