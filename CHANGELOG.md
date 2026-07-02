# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2026-07-02

### Added
- **cPanel Integration & Deployment**: Configured Next.js to compile in `standalone` mode and built an automated deployment script to pack, upload, and extract code directly onto cPanel hosting (`https://sainpricing.pp.ua`).
- **LiteSpeed Server Routing**: Corrected Phusion Passenger and LiteSpeed redirect configurations via automated `.htaccess` regeneration, fixing the 404/503 errors and linking Apache to the application root.

## [1.2.0] - 2026-07-02

### Added
- **Manual SEO Metadata Fields**: Added a collapsible UI form checkbox in Step 2 to manually enter custom **SEO Title**, **URL Slug**, and **Meta Description**. If entered, these values override any AI-generated metadata, providing full CTR control (e.g., matching the keyword 100%).
- **Default API Key Fallback**: Hardcoded the default working OpenCode Zen API key as a fallback inside the codebase (`src/lib/opencode-client.ts`). This allows zero-configuration sharing; the application works out-of-the-box on new team members' PCs even if their `.env` file is missing or hidden.

### Fixed
- **WordPress Image Display (Broken Images)**: Resolved an issue where pre-uploaded images used local file path URLs (like `/uploads/...`) in the HTML post content. The publisher now dynamically retrieves the live WordPress Media Library `source_url` for pre-uploaded images.
- **Image Clumping & Spacing Adjustments**: Installed a sorting and shifting adjuster in the image matching algorithm. If multiple images are assigned to the same paragraph index, the system automatically shifts subsequent images to next available paragraphs to prevent consecutive image clumps.
- **100% Image Distribution**: Ensured all uploaded images are used in the post by distributing unmapped/rejected images evenly across unoccupied paragraphs.
- **Robust JSON Parsing**: Swapped default `JSON.parse` with a flexible quote-escaping repair utility (`extractFlexibleJson`) in the copywriting flow to handle minor AI response syntax errors without crashing.
- **`run.bat` Browser Cleanup**: Fixed the batch launcher script to only stop the node server processes on exit, preventing it from closing other running Firefox windows.
- **Removed Gemini API from Copywriting**: Removed all Gemini API dependencies and timeouts from the copywriting flow to ensure quick, stable execution using OpenCode models.
