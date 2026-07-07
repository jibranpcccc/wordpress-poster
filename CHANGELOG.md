# Changelog

All notable changes to this project will be documented in this file.

## [1.0.2] - 2026-07-07
### Fixed
- **Netlify Timeout on 3+ Images**: Identified the root cause of "Failed to retrieve publication confirmation" — Netlify serverless functions have a hard 26-second timeout. With 3+ images uploading concurrently and each requiring 2 WordPress API calls, the total time exceeded this limit. Fixed by:
  - Switching image uploads from parallel `Promise.all` back to **sequential** uploads with an 8-second `AbortSignal.timeout()` per API call
  - Adding **keepalive ping** events sent to the client every 2 seconds to prevent CDN/proxy from killing the idle streaming connection
  - Adding `AbortSignal.timeout()` to every single WordPress API call (upload, SEO update, post create, tag resolve) to fail fast and not waste the budget
  - Setting `node_bundler = "esbuild"` in `netlify.toml` for faster cold starts

## [1.0.1] - 2026-07-07
### Fixed
- **Stream Reader Parse Bug**: Fixed a critical bug in `OutputViewer.tsx` where `error` events received from the server-sent stream were being silently caught inside the JSON `try/catch` block and swallowed. This caused "Failed to retrieve publication confirmation" whenever more than 2 images were uploaded, because the warning progress messages caused the loop to abort prematurely. Error events are now tracked in a dedicated `streamError` variable and thrown cleanly after the read loop completes.

## [1.0.0] - 2026-07-07
### Added
- **Streaming Publish API**: Implemented real-time server-sent progress updates in `/api/wordpress/publish` to track post generation and image uploading stages, preventing browser timeouts.
- **Parallel Image Upload Optimization**: Optimized media library uploads to WordPress by processing images in parallel batches of 10 instead of 4, significantly speeding up publishing.
- **Cloudflare Vision Cascade**: Configured a high-performance vision pipeline utilizing `Llama 4 Scout (17B)`, `Llama 3.2 Vision (11B)`, and `LLava 1.5 (7B)` to generate precise hair-focused alt text and SEO file names.
- **Robust Failovers**: Configured multi-layered failover paths for copywriting models (first testing Cloudflare's `Llama 3.3/3.1` model pool, then falling back to free `OpenCode` models).
- **Graceful Upload Recovery**: Added warning indicators in the publish stream if individual image uploads fail, allowing post entry creation to finish successfully regardless.

### Changed
- **Raised Serverless Timeouts**: Configured `netlify.toml` functions settings to extend the synchronous route execution limit to 26 seconds.
- **Version Release**: Marked the current state as `v1.0.0` (Stable & Working).
