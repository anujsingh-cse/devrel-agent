import { z } from "zod";

/**
 * Validates and parses GitHub URL ensuring the hostname is strictly github.com.
 * Defends against SSRF and deceptive hostname tricks (e.g., github.com.evil.com).
 */
export function validateAndParseGitHubUrl(rawUrl: string): {
  owner: string;
  repo: string;
  targetNumber: string;
  isPR: boolean;
  isRepoOnly?: boolean;
} {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("GitHub URL must be a non-empty string.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Malformed URL provided.");
  }

  // Strict hostname check
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Invalid URL protocol. Only https/http allowed.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "github.com" && hostname !== "www.github.com") {
    throw new Error("Target URL must be on github.com domain.");
  }

  const pathname = parsed.pathname.replace(/^\//, "").replace(/\/$/, "");
  const parts = pathname.split("/");

  // Expected patterns:
  // owner/repo (repo root)
  // owner/repo/issues/123
  // owner/repo/pull/123
  if (parts.length < 2) {
    throw new Error("URL path must follow format: github.com/{owner}/{repo} or github.com/{owner}/{repo}/{issues|pull}/{number}");
  }

  const [owner, repo, type, numberStr] = parts;

  // Validate owner and repo names (standard GitHub naming conventions)
  const nameRegex = /^[a-zA-Z0-9._-]+$/;
  if (!nameRegex.test(owner) || !nameRegex.test(repo) || owner.includes("..") || repo.includes("..")) {
    throw new Error("Invalid characters in repository owner or name.");
  }

  // Case 1: Repo root only (e.g. github.com/owner/repo)
  if (parts.length === 2) {
    return {
      owner,
      repo,
      targetNumber: "",
      isPR: false,
      isRepoOnly: true,
    };
  }

  // Case 2: Issue or PR
  if (parts.length >= 4) {
    const isPR = type === "pull";
    const isIssue = type === "issues";

    if (!isPR && !isIssue) {
      throw new Error("Target URL subpath must point to an issue or pull request.");
    }

    const num = parseInt(numberStr, 10);
    if (isNaN(num) || num <= 0 || !/^\d+$/.test(numberStr)) {
      throw new Error("Invalid Issue/PR number.");
    }

    return {
      owner,
      repo,
      targetNumber: numberStr,
      isPR,
      isRepoOnly: false,
    };
  }

  throw new Error("URL path must follow format: github.com/{owner}/{repo} or github.com/{owner}/{repo}/{issues|pull}/{number}");
}

/**
 * GitHub Token pattern validator (Classic tokens 'ghp_' and fine-grained 'github_pat_')
 */
export const gitHubTokenSchema = z
  .string()
  .trim()
  .refine(
    (token) =>
      token.length === 0 ||
      token.startsWith("ghp_") ||
      token.startsWith("github_pat_"),
    {
      message: "GitHub token must be a valid Personal Access Token (ghp_... or github_pat_...)",
    }
  )
  .optional();

/**
 * Zod Schema for /api/agent request
 */
export const AgentRequestSchema = z.object({
  url: z.string().min(1, "GitHub URL is required").max(1000),
  mode: z
    .enum(["issue_fix", "elite_pr_contributor", "pr_merger_autopilot", "tool_calling_agent"])
    .default("elite_pr_contributor"),
  reviewComments: z.string().max(50000, "Review comments too large").optional(),
  ciLogs: z.string().max(100000, "CI logs too large").optional(),
  userGithubToken: gitHubTokenSchema,
  dryRun: z.boolean().optional(),
});

export type ValidatedAgentRequest = z.infer<typeof AgentRequestSchema>;

/**
 * Zod Schema for /api/pr-merger request
 */
export const PRMergerRequestSchema = z.object({
  prUrl: z.string().min(1, "Pull Request URL is required").max(1000),
  userGithubToken: gitHubTokenSchema,
  maxCycles: z.number().int().min(1).max(10).default(5),
  autoMergeIfReady: z.boolean().default(true),
});

export type ValidatedPRMergerRequest = z.infer<typeof PRMergerRequestSchema>;

/**
 * Sanitizes untrusted text (e.g. CI logs, issue bodies) before injecting into LLM prompts
 * to mitigate prompt injection, token bloat, and command tampering.
 */
export function sanitizeForPrompt(input: string, maxLength = 8000): string {
  if (!input) return "";

  // 1. Remove dangerous control characters & null bytes
  let sanitized = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");

  // 2. Escape / neutralize common prompt injection jailbreak patterns
  const injectionPatterns = [
    /ignore\s+(all\s+)?previous\s+instructions/gi,
    /disregard\s+(all\s+)?prior\s+instructions/gi,
    /system\s*:\s*you\s+are/gi,
    /assistant\s*:\s*/gi,
    /human\s*:\s*/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi,
  ];

  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, "[FILTERED_PROMPT_INSTRUCTION]");
  }

  // 3. Truncate to safe length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength) + "\n...[truncated for security & token bounds]";
  }

  return sanitized;
}
