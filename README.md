# WordPress Smart Poster

WordPress Smart Poster is a local web application designed to help you build, format, and optimize WordPress posts with smart image placement and SEO optimization. It connects seamlessly to the **OpenCode Zen** gateway without requiring any hardcoded API keys.

## Features

1.  **Dashboard**: Track recent projects, search through posts, see project statuses (Completed, Analyzing, Drafts, Errors), and launch a new post.
2.  **New Post Setup**: Paste an article or upload `.txt`/`.md` text files. Multi-image upload using drag-and-drop. Define keywords, categories, and tags.
3.  **Visual Image Manager**: Match images to paragraph contents, edit suggested SEO filenames (hyphen-separated, lowercase), write alt text, write captions, toggle Featured Image status, or exclude images.
4.  **AI Analysis (OpenCode Zen)**: Multimodal AI analysis (using the model selected in OpenCode, like Gemini 3.5 Flash) that reviews images and places them after the most relevant headings/paragraphs.
5.  **Live Preview**: Renders a Gutenberg-style interactive post preview alongside a side-by-side SEO metadata panel.
6.  **Exporters**: Export options include copying plain HTML, copying Gutenberg Blocks, downloading files (`.txt`/`.html`), CSV export of the SEO table, and a full ZIP archive containing the post and all renamed images.
7.  **WordPress REST API integration**: Optionally enter site URL, username, and Application Password to publish directly as a draft or a published post from the app.

---

## AI Connection & Authentication

The software follows the strict **AI/Auth Rule**:
*   **No API keys are exposed, changed, or hardcoded.**
*   The application automatically looks up the `OPENCODE_ZEN_API_KEY` from the system environment, or reads it from the global `.env` file at `C:\Users\jibra\.hermes\.env` (just like native OpenCode terminal tools).
*   By default, it calls the OpenCode Zen gateway at `https://opencode.ai/zen/v1` using your active selected model (like `gemini-3.5-flash`).
*   **Auto-Fallback Resilience**: If a model is disabled or unreachable, the application automatically cycles through fallback models (like the cost-free `mimo-v2.5-free`) to guarantee that your analysis will complete successfully.

---

## How to Run the App

1.  Open your terminal inside this folder (`c:\Users\jibra\Desktop\1\worpdrepss posting`).
2.  Run the development server on a custom port (e.g. `3001` to avoid conflicts with other proxies):
    ```bash
    npm run dev -- -p 3001
    ```
3.  Open [http://localhost:3001](http://localhost:3001) in your browser.

---

## Project Structure

```
worpdrepss posting/
├── README.md                  # This guide
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx         # Font loading & root document structure
│   │   ├── page.tsx           # Page view controller (Dashboard <-> Wizard)
│   │   └── api/
│   │       ├── analyze/
│   │       │   └── route.ts   # Calls OpenCode Zen API with multimodal images
│   │       ├── projects/
│   │       │   └── route.ts   # Handles listing, loading, saving projects locally
│   │       └── upload/
│   │           └── route.ts   # Saves images/files locally
│   ├── components/
│   │   ├── Dashboard.tsx      # Main dashboard with project statistics
│   │   ├── PostWizard.tsx     # Steps controller
│   │   ├── NewPostForm.tsx    # Drag-and-drop uploads & SEO configurations
│   │   ├── ImageManager.tsx   # Image grid, alt text editing, featured toggling
│   │   ├── LivePreview.tsx    # Gutenberg preview & side-by-side SEO panel
│   │   └── OutputViewer.tsx   # Copy tools, ZIP packages, and WordPress API client
│   └── lib/
│       ├── db.ts              # Flat-file database controller (persists projects as JSON)
│       └── opencode-client.ts # OpenAI client configured to use OpenCode Zen base/keys
├── public/
│   └── uploads/               # Holds uploaded post images
└── src/data/projects/         # Holds saved project JSON files
```
