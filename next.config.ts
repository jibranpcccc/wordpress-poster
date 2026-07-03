import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Mark firebase-admin as external so Netlify plugin copies it rather than symlinking
  // (symlinks require special privileges on Windows — this fixes EPERM during netlify build)
  serverExternalPackages: ['firebase-admin', '@google-cloud/firestore', 'google-auth-library'],
  turbopack: {
    root: path.join(__dirname)
  }
};

export default nextConfig;

