# Changelog

All notable changes to this project will be documented in this file.

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
