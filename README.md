# DevRel Agent — Autonomous Open-Source Contributor & PR Engine

Autonomous AI Agent that reads GitHub issues & maintainer review comments, performs multi-file code fixes, creates test suites, audits diffs, drafts human-like PRs, and auto-fixes CI check failures.

## 🚀 Features

- **8-Phase Contributor Pipeline:**
  1. **Review & Intent Analysis:** Classifies feedback, root causes, tech stack, and target files.
  2. **Multi-File Implementation:** Generates coordinated bug fixes across multiple source files.
  3. **Regression Testing:** Builds matching test files (`jest`, `vitest`, `pytest`, `go_test`).
  4. **Diff Self-Audit:** Audits syntax, type safety, and prevents regressions.
  5. **CI Compliance:** Validates conventional commit & branch naming standards.
  6. **Maintainer Satisfaction Matrix:** Verifies 100% resolution with explicit evidence.
  7. **Atomic PR Creation:** Creates branch, forks if needed, commits files, and opens PR.
  8. **CI Monitoring & Remediation:** Polls GitHub Actions check runs and auto-pushes fixes if tests fail.
- **Autonomous Webhook Triggering:** Listen to `issues.opened` and `pull_request_review.submitted` via `/api/webhook`.
- **Multi-Model Inference Cascade:** Google Gemini SDK -> NVIDIA NIM (Llama 3.1 / Nemotron) -> GitHub Models with automatic fallback.

## 🛠️ Setup & Local Development

1. **Clone repository and install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment Variables:**
   Copy `.env.local.example` to `.env.local` and add your keys:
   ```bash
   cp .env.local.example .env.local
   ```
   Required keys:
   - `GITHUB_TOKEN`: GitHub Personal Access Token (with `repo`, `workflow` scopes).
   - `GEMINI_API_KEY`: Google Gemini API Key.
   - `NVIDIA_API_KEY` (Optional): NVIDIA NIM API key for fallback inference.
   - `GITHUB_WEBHOOK_SECRET` (Optional): Secret for webhook payload verification.

3. **Run development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in browser.

4. **Autonomous Webhook Configuration:**
   In your target GitHub repository:
   - Go to **Settings -> Webhooks -> Add webhook**
   - **Payload URL**: `https://your-domain.com/api/webhook`
   - **Content type**: `application/json`
   - **Events**: Select *Issues* and *Pull request reviews*
