import { Octokit } from "@octokit/rest";
import { LoggerFn } from "../ai-providers";
import {
  fetchFileTree,
  fetchFileContent,
  createGitHubIssue,
  createPullRequest,
  ensureForkAndBranch,
  commitFilesMulti,
} from "../github-client";

export interface StagedFileItem {
  path: string;
  content: string;
  reason?: string;
}

export interface CreatedResource {
  number: number;
  url: string;
  title: string;
}

export interface ToolExecutionContext {
  octokit: Octokit;
  owner: string;
  repo: string;
  targetNumber?: string;
  isPR?: boolean;
  isRepoOnly?: boolean;
  userToken?: string;
  isDryRun?: boolean;
  stagedFiles: Map<string, StagedFileItem>;
  createdIssue?: CreatedResource;
  createdPR?: CreatedResource;
  log?: LoggerFn;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext
): Promise<ToolResult> {
  const { octokit, owner, repo, isDryRun, log } = ctx;

  try {
    switch (name) {
      case "list_directory": {
        const pathPrefix = typeof args.pathPrefix === "string" ? args.pathPrefix.trim().replace(/^\//, "") : "";
        log?.("action", `Tool [list_directory]: Listing tree for "${owner}/${repo}" (prefix: "${pathPrefix || "root"}")...`);
        const tree = await fetchFileTree(octokit, owner, repo);
        const filtered = pathPrefix
          ? tree.filter((p) => p.startsWith(pathPrefix))
          : tree.slice(0, 100);
        return {
          success: true,
          data: {
            totalFiles: filtered.length,
            sampleFiles: filtered.slice(0, 50),
          },
        };
      }

      case "fetch_file_content": {
        const path = String(args.path || "").trim();
        const ref = typeof args.ref === "string" ? args.ref : undefined;
        if (!path) return { success: false, error: "File path is required." };

        log?.("action", `Tool [fetch_file_content]: Reading "${path}"...`);
        const file = await fetchFileContent(octokit, owner, repo, path, ref);
        const lines = file.content.split("\n");
        return {
          success: true,
          data: {
            path,
            totalLines: lines.length,
            sizeBytes: file.content.length,
            content: file.content.length > 30000 ? file.content.slice(0, 30000) + "\n...[truncated for token bounds]" : file.content,
          },
        };
      }

      case "search_code": {
        const query = String(args.query || "").trim().toLowerCase();
        if (!query) return { success: false, error: "Search query is required." };

        log?.("action", `Tool [search_code]: Searching repository for "${query}"...`);
        const tree = await fetchFileTree(octokit, owner, repo);
        const candidateFiles = tree.filter((p) =>
          /\.(ts|tsx|js|jsx|py|go|rs|java|json|md|yaml|yml|toml)$/i.test(p)
        );

        const matches: Array<{ file: string; line: number; snippet: string }> = [];
        // Scan priority candidate files
        for (const filePath of candidateFiles.slice(0, 25)) {
          try {
            const file = await fetchFileContent(octokit, owner, repo, filePath);
            const lines = file.content.split("\n");
            lines.forEach((line, idx) => {
              if (line.toLowerCase().includes(query) && matches.length < 20) {
                matches.push({
                  file: filePath,
                  line: idx + 1,
                  snippet: line.trim().slice(0, 120),
                });
              }
            });
          } catch {
            // Ignore unreadable files
          }
          if (matches.length >= 20) break;
        }

        return {
          success: true,
          data: {
            query,
            matchCount: matches.length,
            matches,
          },
        };
      }

      case "create_github_issue": {
        const title = String(args.title || "").trim();
        const body = String(args.body || "").trim();
        const labels = Array.isArray(args.labels) ? (args.labels as string[]) : ["bot", "devrel-agent", "bug"];

        if (!title || !body) {
          return { success: false, error: "Both title and body are required to create an issue." };
        }

        log?.("action", `Tool [create_github_issue]: Opening issue "${title}"...`);

        if (isDryRun) {
          const fakeNumber = 901;
          const fakeUrl = `https://github.com/${owner}/${repo}/issues/${fakeNumber} (Safe Preview)`;
          ctx.createdIssue = { number: fakeNumber, url: fakeUrl, title };
          log?.("success", `[Safe Preview] Issue drafted: "${title}" (Simulated #${fakeNumber})`);
          return {
            success: true,
            data: {
              status: "simulated_dry_run",
              issueNumber: fakeNumber,
              issueUrl: fakeUrl,
              title,
            },
          };
        }

        const issue = await createGitHubIssue(octokit, owner, repo, title, body, labels);
        ctx.createdIssue = { number: issue.number, url: issue.html_url, title };
        log?.("success", `Successfully created GitHub Issue #${issue.number}: ${issue.html_url}`);
        return {
          success: true,
          data: {
            issueNumber: issue.number,
            issueUrl: issue.html_url,
            title,
          },
        };
      }

      case "stage_file_change": {
        const path = String(args.path || "").trim().replace(/^\//, "");
        const content = String(args.content || "");
        const reason = typeof args.reason === "string" ? args.reason : "Resolution fix";

        if (!path || !content) {
          return { success: false, error: "File path and content are required to stage changes." };
        }

        ctx.stagedFiles.set(path, { path, content, reason });
        log?.("action", `Tool [stage_file_change]: Staged "${path}" (${content.length} bytes, reason: ${reason}).`);
        return {
          success: true,
          data: {
            stagedPath: path,
            totalStagedFiles: ctx.stagedFiles.size,
            sizeBytes: content.length,
          },
        };
      }

      case "get_staged_changes": {
        const stagedList = Array.from(ctx.stagedFiles.values()).map((f) => ({
          path: f.path,
          sizeBytes: f.content.length,
          reason: f.reason,
          preview: f.content.slice(0, 200) + (f.content.length > 200 ? "..." : ""),
        }));
        return {
          success: true,
          data: {
            stagedCount: stagedList.length,
            files: stagedList,
          },
        };
      }

      case "commit_and_create_pr": {
        const title = String(args.title || "").trim();
        const body = String(args.body || "").trim();
        const branchName = String(args.branchName || `devrel/auto-fix-${Date.now().toString(36)}`).trim();

        if (!title || !body) {
          return { success: false, error: "PR title and body are required." };
        }

        if (ctx.stagedFiles.size === 0) {
          return {
            success: false,
            error: "No files staged. Call stage_file_change tool first before committing and creating a PR.",
          };
        }

        const filesToCommit = Array.from(ctx.stagedFiles.values()).map((f) => ({
          path: f.path,
          content: f.content,
        }));

        log?.("action", `Tool [commit_and_create_pr]: Committing ${filesToCommit.length} file(s) to branch "${branchName}"...`);

        if (isDryRun) {
          const fakePrNumber = 902;
          const fakePrUrl = `https://github.com/${owner}/${repo}/pull/${fakePrNumber} (Safe Preview)`;
          ctx.createdPR = { number: fakePrNumber, url: fakePrUrl, title };
          log?.("success", `[Safe Preview] Pull Request formulated: "${title}" (Branch: ${branchName})`);
          return {
            success: true,
            data: {
              status: "simulated_dry_run",
              prNumber: fakePrNumber,
              prUrl: fakePrUrl,
              branchName,
              filesCommitted: filesToCommit.map((f) => f.path),
            },
          };
        }

        // Live commit & PR workflow
        const { targetOwner, defaultBranch } = await ensureForkAndBranch(
          octokit,
          owner,
          repo,
          branchName,
          log
        );

        await commitFilesMulti(
          octokit,
          targetOwner,
          repo,
          branchName,
          title,
          filesToCommit
        );

        const pr = await createPullRequest(
          octokit,
          owner,
          repo,
          targetOwner,
          branchName,
          defaultBranch,
          title,
          body
        );

        ctx.createdPR = { number: pr.number, url: pr.html_url, title };
        log?.("success", `Successfully opened GitHub Pull Request #${pr.number}: ${pr.html_url}`);
        return {
          success: true,
          data: {
            prNumber: pr.number,
            prUrl: pr.html_url,
            branchName,
            filesCommitted: filesToCommit.map((f) => f.path),
          },
        };
      }

      case "inspect_ci_status": {
        log?.("action", `Tool [inspect_ci_status]: Checking CI runs for "${owner}/${repo}"...`);
        const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
        const { data: checks } = await octokit.rest.checks.listForRef({
          owner,
          repo,
          ref: repoData.default_branch,
        });
        return {
          success: true,
          data: {
            totalChecks: checks.total_count,
            runs: checks.check_runs.map((r) => ({
              name: r.name,
              status: r.status,
              conclusion: r.conclusion,
            })),
          },
        };
      }

      case "inspect_pr_reviews": {
        const prNum = parseInt(String(args.prNumber || ctx.targetNumber || "0"), 10);
        if (!prNum) return { success: false, error: "Valid PR number required." };

        log?.("action", `Tool [inspect_pr_reviews]: Inspecting reviews on PR #${prNum}...`);
        const { data: reviews } = await octokit.rest.pulls.listReviews({
          owner,
          repo,
          pull_number: prNum,
        });
        const { data: comments } = await octokit.rest.pulls.listReviewComments({
          owner,
          repo,
          pull_number: prNum,
        });

        return {
          success: true,
          data: {
            reviews: reviews.map((r) => ({ user: r.user?.login, state: r.state, body: r.body })),
            inlineComments: comments.map((c) => ({
              user: c.user?.login,
              path: c.path,
              line: c.line,
              body: c.body,
            })),
          },
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log?.("error", `Tool [${name}] failed: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}
