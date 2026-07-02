# Redrob Candidate Shortlist Ranking & Compliance Suite

An intelligent full-stack system designed to ingest, filter, and prioritize talent profiles utilizing a custom hybrid engine: deterministic multi-criteria weights matching and high-precision evaluation backed by server-side Gemini AI models.

## 🚀 Key Features

- **Hybrid Evaluation Engine**: Combines structural multi-parameter matching (Skills, Experience, Expected Salary, Notice Period, Education Tier, and GitHub Activity) with server-side AI evaluation using Gemini 3.5 Flash.
- **Tuning Sliders**: Adjust relative weights dynamically to calibrate how various criteria affect overall candidate suitability scores.
- **Precision AI Screenings**: Runs multi-stage evaluations resulting in a detailed candidate analysis, list of strengths (pros), areas of concern (cons), tailored technical/behavioral interview questions, and a definitive matching verdict.
- **Challenge Compliance Suite**: Automatically validates candidate shortlists against the strict structural, ranking, and alphabetical tie-breaker rules of the candidate ranking challenge. Includes a drag-and-drop external validator to verify any custom `.csv` submission files.
- **Export Capabilities**: Download fully formatted text shortlist summaries or compliant `submission.csv` files with a single click.

---

## 🛠️ Tech Stack & Architecture

- **Frontend**: React 18, Vite, Tailwind CSS, Lucide React, and Motion (for visual transitions).
- **Backend**: Express Custom Server (`server.ts`) proxying API calls to secure Google Gemini AI endpoints.
- **AI model**: `gemini-3.5-flash` with a tailored structural response schema (`application/json`).
- **Resilience**: Configured with a 120-second client-to-server request timeout to handle detailed long-context AI evaluations reliably without triggering `HeadersTimeoutError` or Node-level fetch timeouts.

---

## 📋 Running the Application

### 1. Configure Environment Secrets
Ensure you have configured your `GEMINI_API_KEY` in the workspace or created a `.env` file containing:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Start Development Server
```bash
npm run dev
```
The server binds to port `3000` at `0.0.0.0` and serves the application with hot-reloading asset compilation handled automatically.

### 4. Build for Production
```bash
npm run build
```
This generates optimized client assets and compiles the backend into a standalone, optimized CommonJS file (`dist/server.cjs`) via `esbuild`.

---

## 🛡️ Validation Rules (Directly Mirroring Challenge Rules)

To ensure generated shortlists are 100% compliant with validation requirements, our compliance validator verifies:
1. **Row Count Constraint**: Exactly 100 data rows (ranks 1 to 100).
2. **Deterministic Sequence**: Shortlist rows must be ordered in strict non-increasing order of suitability scores (`score[i] >= score[i+1]`).
3. **Lexicographical Tie-breaking**: When scores are identical, candidate rows must be ordered alphabetically by their `candidate_id` (`candidate_id[i] < candidate_id[i+1]`).
4. **Header Constraint**: Row 1 must exactly read `candidate_id,rank,score,reasoning`.
