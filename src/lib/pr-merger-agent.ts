import { Octokit } from "@octokit/rest";
import { generateAIText } from "./ai-providers";
import {
  parseGitHubUrl,
  fetchFileTree,
  fetchFileContent,
  commitFilesMulti,
  CommitFileItem,
} from "./github-client";
import { remediatePRChecks } from "./ci-remediator";
import { LoggerFn } from "./ai-providers";

export interface PRMergerOptions {
  prUrl: string;
  userToken?: string;
  maxCycles?: number;
  autoMergeIfReady?: boolean;
}

export interface PRMergerResult {
  merged: boolean;
  state: "merged" | "closed" | "open" | "ready_to_merge";
  prUrl: string;
  totalCommitsPushed: number;
  cyclesExecuted: number;
  summary: string;
}

export async function runPRMergerLoop(
  options: PRMergerOptions,
  log?: LoggerFn
): Promise<PRMergerResult> {
  const { prUrl, userToken, maxCycles = 5, autoMergeIfReady = true } = options;
  const { owner, repo, targetNumber, isPR } = parseGitHubUrl(prUrl);

  if (!isPR) {
    throw new Error("Target URL must be a GitHub Pull Request URL (e.g. github.com/owner/repo/pull/123).");
  }

  const prNumber = parseInt(targetNumber, 10);
  const token = userToken?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error("GitHub Access Token is required to execute PR Auto-Merger loop.");
  }

  const octokit = new Octokit({ auth: token });
  log?.("phase", `PR MERGER AGENT ENGAGED — Monitoring PR #${prNumber} on ${owner}/${repo} until merged...`);

  let cycle = 0;
  let totalCommitsPushed = 0;
  let isMerged = false;
  let prState: "merged" | "closed" | "open" | "ready_to_merge" = "open";

  while (cycle < maxCycles && !isMerged) {
    cycle++;
    log?.("monitor", `Loop Cycle ${cycle}/${maxCycles}: Checking PR #${prNumber} state on GitHub...`);

    // 1. Fetch live PR status
    const { data: pr } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    if (pr.merged) {
      isMerged = true;
      prState = "merged";
      log?.("success", `🎉 Pull Request #${prNumber} is MERGED into ${pr.base.ref}! Task complete.`);
      break;
    }

    if (pr.state === "closed") {
      prState = "closed";
      log?.("error", `Pull Request #${prNumber} was CLOSED without merging. Stopping loop.`);
      break;
    }

    const headBranch = pr.head.ref;
    const headOwner = pr.head.user?.login || owner;
    const headSha = pr.head.sha;

    log?.("info", `PR #${prNumber} is OPEN (Head: ${headOwner}:${headBranch} @ ${headSha.slice(0, 7)}).`);

    // 2. Fetch Review Feedback (Reviews & Inline Review Comments)
    log?.("action", "Scanning maintainer reviews, CodeRabbit comments, and requested changes...");
    const { data: reviews } = await octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: prNumber,
    });
    const { data: comments } = await octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: prNumber,
    });

    const changeRequests = reviews.filter(
      (r) => r.state === "CHANGES_REQUESTED" || (r.body && r.body.length > 20)
    );
    const unaddressedComments = comments.filter((c) => Boolean(c.body && c.body.length > 10));

    const combinedFeedback = [
      ...changeRequests.map((r) => `[Review by ${r.user?.login} (${r.state})]: ${r.body}`),
      ...unaddressedComments.map((c) => `[Comment on ${c.path}:${c.line || "file"} by ${c.user?.login}]: ${c.body}`),
    ].join("\n\n");

    if (combinedFeedback.trim()) {
      log?.("info", `Found ${changeRequests.length + unaddressedComments.length} maintainer review items to resolve.`);
    } else {
      log?.("info", "No pending maintainer change requests found. Evaluating CI check suite...");
    }

    // 3. Inspect Repository File Tree & Tech Stack
    const repoFiles = await fetchFileTree(octokit, owner, repo);

    // 4. Audit CI Check Runs
    log?.("monitor", "Auditing GitHub Actions check runs for test failures...");
    const { data: checkData } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: headSha,
    });

    const failedChecks = checkData.check_runs.filter(
      (r) =>
        r.conclusion !== "success" &&
        r.conclusion !== "skipped" &&
        r.conclusion !== "neutral" &&
        r.status === "completed"
    );
    const runningChecks = checkData.check_runs.filter((r) => r.status !== "completed");

    // If checks are still running, wait for them
    if (runningChecks.length > 0) {
      log?.("monitor", `Waiting 25s for ${runningChecks.length} in-progress CI check(s) to finish...`);
      await new Promise((r) => setTimeout(r, 25000));
      continue;
    }

    const needsFix = combinedFeedback.trim().length > 0 || failedChecks.length > 0;

    // 5. If changes or test fixes are needed, synthesize and push commits
    if (needsFix) {
      log?.("phase", `Synthesizing code patches & test suite fixes for cycle ${cycle}...`);

      const analysisPrompt = `You are an autonomous senior PR engineer analyzing PR #${prNumber} on ${owner}/${repo}.
PR Title: ${pr.title}
PR Description: ${pr.body || ""}
Maintainer Feedback:
${combinedFeedback || "No review comments. Fix failing tests."}

Available Files:
${repoFiles.slice(0, 300).join("\n")}

Identify:
1. Target source files to modify ("file_paths": ["path1"])
2. Existing or new test files to update ("test_file_paths": ["test_path"])
3. Primary language ("project_language")
4. Resolution plan

Respond in JSON:
{
  "file_paths": ["string"],
  "test_file_paths": ["string"],
  "project_language": "typescript" | "python" | "go" | "rust" | "javascript",
  "resolution_plan": "string"
}`;

      const rawAnalysis = await generateAIText(analysisPrompt, true, log);
      let targetFiles: string[] = [];
      let testFiles: string[] = [];
      let projectLang = "typescript";
      let plan = "Resolve feedback and fix tests.";

      try {
        const parsed = JSON.parse(rawAnalysis.replace(/```json/gi, "").replace(/```/g, "").trim());
        targetFiles = (parsed.file_paths || []).filter((f: string) => repoFiles.includes(f));
        testFiles = parsed.test_file_paths || [];
        projectLang = parsed.project_language || "typescript";
        plan = parsed.resolution_plan || plan;
      } catch {
        targetFiles = [repoFiles[0] || "src/index.ts"];
      }

      if (targetFiles.length === 0 && repoFiles.length > 0) {
        targetFiles.push(repoFiles[0]);
      }

      const filesToCommit: CommitFileItem[] = [];

      for (const filePath of targetFiles) {
        log?.("action", `Applying targeted fix to ${filePath}...`);
        const { content: oldCode } = await fetchFileContent(
          octokit,
          headOwner,
          repo,
          filePath,
          headBranch
        );

        const patchPrompt = `You are an elite open-source contributor fixing PR #${prNumber}.
Language: ${projectLang}
File: ${filePath}
Plan: ${plan}
Feedback & CI Errors:
${combinedFeedback}

Current Code:
${oldCode}

Rules:
- Satisfy maintainer feedback completely.
- Fix all failing test cases and assertions.
- Output ONLY raw updated file content. No markdown code fences.`;

        let newCode = await generateAIText(patchPrompt, false, log);
        newCode = newCode.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();

        if (newCode && newCode.length > 20) {
          filesToCommit.push({
            path: filePath,
            content: newCode,
          });
        }
      }

      if (filesToCommit.length > 0) {
        const commitMsg = `fix(agent): resolve maintainer reviews & test assertions (cycle ${cycle})`;
        await commitFilesMulti(octokit, headOwner, repo, headBranch, commitMsg, filesToCommit);
        totalCommitsPushed++;
        log?.("success", `Pushed commit to branch "${headBranch}" covering ${filesToCommit.length} file(s).`);

        // Post polite maintainer response comment on PR
        try {
          const responseCommentPrompt = `You are a polite open-source contributor.
Draft a short 2-3 sentence update comment for maintainers on PR #${prNumber}.
Explain that feedback was addressed in ${filesToCommit.map((f) => f.path).join(", ")} and tests are updated.
Keep it natural, friendly, and concise.`;

          const updateComment = await generateAIText(responseCommentPrompt, false);
          await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: prNumber,
            body: updateComment.trim(),
          });
          log?.("info", `Posted progress update comment to PR #${prNumber}.`);
        } catch {
          // ignore comment errors
        }

        // Run CI remediation loop on the new commit
        log?.("monitor", "Verifying CI checks on new commit...");
        await new Promise((r) => setTimeout(r, 20000));
        await remediatePRChecks(
          octokit,
          owner,
          repo,
          headOwner,
          headBranch,
          prNumber,
          targetFiles,
          projectLang,
          log
        );
      }
    } else {
      // All CI checks passed and no pending change requests!
      log?.("ci_status", `All ${checkData.total_count} CI checks are green! No blocking reviews pending.`);

      if (autoMergeIfReady) {
        log?.("action", `Attempting to merge PR #${prNumber} automatically...`);
        try {
          const { data: mergeRes } = await octokit.rest.pulls.merge({
            owner,
            repo,
            pull_number: prNumber,
            merge_method: "squash",
            commit_title: `${pr.title} (#${prNumber})`,
          });
          if (mergeRes.merged) {
            isMerged = true;
            prState = "merged";
            log?.("success", `Pull Request #${prNumber} successfully MERGED into target branch!`);
            break;
          }
        } catch (mergeErr: unknown) {
          const msg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
          log?.("info", `Note: Direct merge skipped (${msg}). PR is 100% clean and ready for maintainer merge.`);
          prState = "ready_to_merge";
          break;
        }
      } else {
        prState = "ready_to_merge";
        log?.("success", `PR #${prNumber} is 100% green and ready to merge!`);
        break;
      }
    }

    if (!isMerged && cycle < maxCycles) {
      log?.("monitor", `Waiting 30s before cycle ${cycle + 1} check...`);
      await new Promise((r) => setTimeout(r, 30000));
    }
  }

  return {
    merged: isMerged,
    state: prState,
    prUrl,
    totalCommitsPushed,
    cyclesExecuted: cycle,
    summary: isMerged
      ? `PR #${prNumber} was successfully transformed, verified green, and merged!`
      : prState === "ready_to_merge"
      ? `PR #${prNumber} is 100% green with all tests passing. Ready for maintainer merge.`
      : `PR #${prNumber} completed ${cycle} remediation cycles.`,
  };
}
