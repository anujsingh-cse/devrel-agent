import { Octokit } from "@octokit/rest";
import { LoggerFn } from "./ai-providers";

export interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  targetNumber: string;
  isPR: boolean;
}

export function parseGitHubUrl(url: string): ParsedGitHubUrl {
  if (!url || !url.includes("github.com")) {
    throw new Error("Invalid GitHub URL.");
  }
  const issueMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  const prMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);

  if (!issueMatch && !prMatch) {
    throw new Error("Could not parse owner, repo, and issue/PR number from URL.");
  }

  const isPR = Boolean(prMatch);
  return {
    owner: isPR ? prMatch![1] : issueMatch![1],
    repo: isPR ? prMatch![2] : issueMatch![2],
    targetNumber: isPR ? prMatch![3] : issueMatch![3],
    isPR,
  };
}

export function getOctokit(customToken?: string): Octokit {
  const token = customToken?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (token) {
    return new Octokit({ auth: token });
  }
  return new Octokit();
}

export async function fetchFileTree(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<string[]> {
  const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
  const { data: treeData } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: repoData.default_branch,
    recursive: "true",
  });

  const treeEntries = treeData.tree as Array<{ type?: string; path?: string }>;
  return treeEntries
    .filter((t) => t.type === "blob" && t.path)
    .map((t) => t.path as string)
    .filter(
      (path) =>
        !path.match(
          /\.(png|jpg|jpeg|gif|svg|ico|mp4|webp|lock|csv|jsonl|pdf|ttf|woff|woff2)$/i
        )
    )
    .filter(
      (path) =>
        !path.includes("node_modules/") &&
        !path.includes("vendor/") &&
        !path.includes("dist/") &&
        !path.includes("build/") &&
        !path.includes(".next/")
    );
}

export async function fetchFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<{ content: string; sha: string }> {
  const cleanPath = path.replace(/^\//, "");
  const response = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: cleanPath,
    ...(ref ? { ref } : {}),
  });
  const fileData = response.data;
  if (Array.isArray(fileData) || !("content" in fileData)) {
    throw new Error(`Path ${cleanPath} is a directory or binary blob.`);
  }
  return {
    content: Buffer.from(fileData.content, "base64").toString("utf-8"),
    sha: fileData.sha,
  };
}

export async function ensureForkAndBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string,
  log?: LoggerFn
): Promise<{ targetOwner: string; defaultBranch: string }> {
  const { data: user } = await octokit.rest.users.getAuthenticated();
  const username = user.login;
  let targetOwner = owner;

  if (owner !== username) {
    log?.("action", `Checking / creating fork under ${username}...`);
    try {
      await octokit.rest.repos.createFork({ owner, repo });
      targetOwner = username;

      // Poll until fork repository is ready (up to 30s)
      let ready = false;
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        try {
          await octokit.rest.repos.get({ owner: username, repo });
          ready = true;
          break;
        } catch {
          log?.("info", `Waiting for GitHub fork provisioning (attempt ${i + 1}/6)...`);
        }
      }
      if (!ready) {
        targetOwner = owner;
      }
    } catch {
      try {
        await octokit.rest.repos.get({ owner: username, repo });
        targetOwner = username;
      } catch {
        targetOwner = owner;
      }
    }
  }

  const { data: repoData } = await octokit.rest.repos.get({ owner: targetOwner, repo });
  const defaultBranch = repoData.default_branch;
  const { data: refData } = await octokit.rest.git.getRef({
    owner: targetOwner,
    repo,
    ref: `heads/${defaultBranch}`,
  });
  const baseSha = refData.object.sha;

  await octokit.rest.git.createRef({
    owner: targetOwner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseSha,
  });

  return { targetOwner, defaultBranch };
}

export interface CommitFileItem {
  path: string;
  content: string;
  sha?: string;
}

export async function commitFilesMulti(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  message: string,
  files: CommitFileItem[]
): Promise<void> {
  if (!files || files.length === 0) return;

  // Multi-file and single-file atomic commit using Git Tree API (no sha required)
  const { data: branchRef } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  const latestCommitSha = branchRef.object.sha;

  const { data: latestCommit } = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: latestCommitSha,
  });

  // Create tree entries
  const treeEntries: Array<{
    path: string;
    mode: "100644";
    type: "blob";
    content: string;
  }> = files.map((f) => ({
    path: f.path,
    mode: "100644",
    type: "blob",
    content: f.content,
  }));

  const { data: newTree } = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: latestCommit.tree.sha,
    tree: treeEntries,
  });

  const { data: newCommit } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message,
    tree: newTree.sha,
    parents: [latestCommitSha],
  });

  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });
}
