import { Octokit } from "@octokit/rest";
import { generateAIText } from "./ai-providers";
import { fetchFileContent, commitFilesMulti, CommitFileItem } from "./github-client";
import { LoggerFn } from "./ai-providers";
import { sanitizeForPrompt } from "./validation";


export interface CIRemediationResult {
  success: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: string[];
  remediationAttempts: number;
  logsAnalyzed?: string;
}

export async function remediatePRChecks(
  octokit: Octokit,
  owner: string,
  repo: string,
  targetOwner: string,
  branchName: string,
  prNumber: number,
  targetFiles: string[],
  projectLanguage: string,
  log?: LoggerFn
): Promise<CIRemediationResult> {
  const MAX_REMEDIATION_CYCLES = 3;
  const POLL_INTERVAL_MS = 20_000; // 20 seconds
  const MAX_WAIT_PER_CYCLE_MS = 5 * 60 * 1000; // 5 minutes max wait for CI jobs to run

  let remediationCycle = 0;
  let allPassed = false;
  let lastFailedNames: string[] = [];
  let totalCheckCount = 0;
  let passedCheckCount = 0;

  while (remediationCycle < MAX_REMEDIATION_CYCLES && !allPassed) {
    log?.(
      "monitor",
      `CI Watch Loop ${remediationCycle + 1}/${MAX_REMEDIATION_CYCLES} — Polling checks on branch "${branchName}"...`
    );

    // 1. Get latest head SHA
    let headSha = "";
    try {
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });
      headSha = pr.head.sha;
    } catch {
      log?.("info", "Could not fetch PR head SHA. Bypassing CI monitor.");
      break;
    }

    // 2. Poll check runs until complete or timeout
    const pollStart = Date.now();
    let runsFinished = false;
    let failedRuns: Array<{ name: string; conclusion: string | null }> = [];

    while (Date.now() - pollStart < MAX_WAIT_PER_CYCLE_MS) {
      try {
        const { data: checkData } = await octokit.rest.checks.listForRef({
          owner,
          repo,
          ref: headSha,
        });

        totalCheckCount = checkData.total_count;
        const runs = checkData.check_runs;

        // Grace period if 0 checks registered yet
        if (totalCheckCount === 0) {
          log?.("monitor", "Waiting 15s for GitHub Actions workflows to initialize...");
          await new Promise((r) => setTimeout(r, 15000));
          const { data: recheck } = await octokit.rest.checks.listForRef({
            owner,
            repo,
            ref: headSha,
          });
          if (recheck.total_count === 0) {
            log?.("info", "No automated check suites configured on this repository.");
            runsFinished = true;
            allPassed = true;
            break;
          }
          continue;
        }

        const pending = runs.filter((r) => r.status !== "completed");
        if (pending.length > 0) {
          log?.(
            "monitor",
            `Running: ${pending.length}/${totalCheckCount} check(s) in progress (${pending.map((p) => p.name).join(", ")})... waiting 20s`
          );
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }

        // All checks completed
        runsFinished = true;
        failedRuns = runs.filter(
          (r) =>
            r.conclusion !== "success" &&
            r.conclusion !== "skipped" &&
            r.conclusion !== "neutral"
        );
        passedCheckCount = runs.filter(
          (r) =>
            r.conclusion === "success" ||
            r.conclusion === "skipped" ||
            r.conclusion === "neutral"
        ).length;

        lastFailedNames = failedRuns.map((f) => f.name);

        if (failedRuns.length === 0) {
          allPassed = true;
          log?.("ci_status", `All ${totalCheckCount} CI check runs passed green on GitHub!`);
        }
        break;
      } catch (pollErr: unknown) {
        const errMsg = pollErr instanceof Error ? pollErr.message : String(pollErr);
        log?.("info", `Check status poll: ${errMsg.slice(0, 80)}. Retrying...`);
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    }

    if (!runsFinished) {
      log?.("monitor", "CI poll cycle timed out. Check runs may still be processing.");
      break;
    }

    if (allPassed) break;

    // 3. Extract failure logs from GitHub Actions
    log?.(
      "ci_status",
      `Detected ${failedRuns.length} failing check(s): [${lastFailedNames.join(", ")}]. Fetching error logs...`
    );

    let extractedErrorLogs = "";
    try {
      const { data: workflowRuns } = await octokit.rest.actions.listWorkflowRunsForRepo({
        owner,
        repo,
        head_sha: headSha,
        per_page: 5,
      });

      for (const run of workflowRuns.workflow_runs) {
        if (run.conclusion === "failure" || run.conclusion === "cancelled") {
          const { data: jobsData } = await octokit.rest.actions.listJobsForWorkflowRun({
            owner,
            repo,
            run_id: run.id,
          });

          for (const job of jobsData.jobs) {
            if (job.conclusion === "failure") {
              try {
                const logRes = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
                  owner,
                  repo,
                  job_id: job.id,
                });
                const rawLogText =
                  typeof logRes.data === "string" ? logRes.data : String(logRes.data);
                // Keep the most relevant error lines
                const errorLines = rawLogText
                  .split("\n")
                  .filter(
                    (l) =>
                      l.toLowerCase().includes("error") ||
                      l.toLowerCase().includes("fail") ||
                      l.toLowerCase().includes("assert") ||
                      l.toLowerCase().includes("typeerror") ||
                      l.toLowerCase().includes("syntaxerror")
                  )
                  .slice(-40)
                  .join("\n");

                extractedErrorLogs += `\n[Workflow: ${run.name} / Job: ${job.name}]:\n${errorLines || rawLogText.slice(-2500)}\n`;
              } catch {
                extractedErrorLogs += `\n[Job: ${job.name}] Failed step details url: ${job.html_url}\n`;
              }
            }
          }
        }
      }
    } catch {
      log?.("info", "Workflow job logs API restricted or unavailable. Using check summary.");
    }

    if (!extractedErrorLogs.trim()) {
      extractedErrorLogs = `Failing check runs: ${lastFailedNames.join(", ")}. Tests or linters failed.`;
    }

    log?.(
      "action",
      `Analyzing failure traceback with NVIDIA NIM to auto-remediate code in [${targetFiles.join(", ")}]...`
    );

    // 4. Fetch current file contents from PR branch & generate fixes
    const updatedFilesToCommit: CommitFileItem[] = [];

    for (const filePath of targetFiles) {
      try {
        const { content: currentFileCode } = await fetchFileContent(
          octokit,
          targetOwner,
          repo,
          filePath,
          branchName
        );

        const sanitizedLogs = sanitizeForPrompt(extractedErrorLogs, 6000);
        const remediationPrompt = `You are an elite open-source contributor fixing CI test / build failures on Pull Request #${prNumber}.
Language: ${projectLanguage}
File: ${filePath}
Remediation Attempt: ${remediationCycle + 1}/${MAX_REMEDIATION_CYCLES}

CI FAILURE TRACEBACK & LOGS:
${sanitizedLogs}

CURRENT FILE CONTENT:
${currentFileCode}

CRITICAL RULES:
1. Fix the EXACT error shown in the failure logs (e.g. assertion error, missing import, syntax/type error, incorrect mock, or broken logic).
2. DO NOT introduce breaking changes or delete needed tests.
3. If test file itself is failing due to invalid imports or wrong test framework mocks, fix the test logic to match repository standards.
4. Output ONLY the raw complete updated code for ${filePath}. No markdown code blocks, no chat.`;


        let remediatedCode = await generateAIText(remediationPrompt, false, log);
        remediatedCode = remediatedCode
          .replace(/^```[\w]*\n?/, "")
          .replace(/\n?```$/, "")
          .trim();

        if (remediatedCode && remediatedCode.length > 20) {
          updatedFilesToCommit.push({
            path: filePath,
            content: remediatedCode,
          });
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log?.("info", `Could not remediate ${filePath}: ${errMsg.slice(0, 60)}`);
      }
    }

    if (updatedFilesToCommit.length > 0) {
      try {
        await commitFilesMulti(
          octokit,
          targetOwner,
          repo,
          branchName,
          `fix: auto-remediate CI test failures for PR #${prNumber} (cycle ${remediationCycle + 1})`,
          updatedFilesToCommit
        );
        log?.(
          "success",
          `Pushed auto-remediation commit (${remediationCycle + 1}/${MAX_REMEDIATION_CYCLES}) covering ${updatedFilesToCommit.length} file(s) to branch "${branchName}".`
        );
      } catch (commitErr: unknown) {
        const errMsg = commitErr instanceof Error ? commitErr.message : String(commitErr);
        log?.("error", `Failed to push remediation commit: ${errMsg}`);
        break;
      }
    } else {
      log?.("info", "No code transformations generated for this cycle.");
      break;
    }

    remediationCycle++;
    if (remediationCycle < MAX_REMEDIATION_CYCLES) {
      log?.("monitor", "Waiting 25s for new GitHub Actions workflow run to trigger...");
      await new Promise((r) => setTimeout(r, 25000));
    }
  }

  return {
    success: allPassed,
    totalChecks: totalCheckCount,
    passedChecks: passedCheckCount,
    failedChecks: lastFailedNames,
    remediationAttempts: remediationCycle,
    logsAnalyzed: allPassed ? undefined : "Exhausted auto-remediation cycles.",
  };
}
