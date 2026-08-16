import type OpenAI from "openai";

export interface ToolPropertySchema {
  type: string;
  description: string;
  enum?: string[];
  items?: {
    type: string;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolPropertySchema>;
    required?: string[];
  };
}

export const DEVREL_TOOLS: ToolDefinition[] = [
  {
    name: "list_directory",
    description:
      "Explore and list repository file paths. Optionally provide a sub-directory prefix to filter.",
    parameters: {
      type: "object",
      properties: {
        pathPrefix: {
          type: "string",
          description: "Sub-directory prefix to filter by (e.g. 'src/lib' or 'tests'). Leave empty for root.",
        },
      },
    },
  },
  {
    name: "fetch_file_content",
    description:
      "Read the full UTF-8 source content of any file in the repository at a given path.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative repository file path (e.g. 'src/lib/auth.ts' or 'package.json').",
        },
        ref: {
          type: "string",
          description: "Optional Git ref, branch, or commit SHA to read from.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "search_code",
    description:
      "Search for keyword, function name, class, import, or pattern across repository source files.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Exact text or keyword to search for across repository code.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "create_github_issue",
    description:
      "Autonomously open a new GitHub Issue on the target repository documenting a discovered bug, missing feature, or technical improvement.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Clear, concise issue title (e.g. 'fix: unhandled promise rejection in auth middleware').",
        },
        body: {
          type: "string",
          description: "Structured issue body with Description, Root Cause, Reproduction Steps, and Proposed Fix.",
        },
        labels: {
          type: "array",
          description: "Labels to attach to the issue (e.g. ['bug', 'devrel-agent']).",
          items: {
            type: "string",
          },
        },
      },
      required: ["title", "body"],
    },
  },
  {
    name: "stage_file_change",
    description:
      "Stage a new or modified source/test file in memory for resolution before committing.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative repository file path to create or update (e.g. 'src/utils/parser.ts').",
        },
        content: {
          type: "string",
          description: "Complete, drop-in replacement file content. Must be production-ready code with no truncation.",
        },
        reason: {
          type: "string",
          description: "Brief reason explaining why this file is changed or created.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "get_staged_changes",
    description:
      "Review all currently staged file changes and code diffs before committing and creating a Pull Request.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "commit_and_create_pr",
    description:
      "Commit all staged files into a new branch and open a GitHub Pull Request linked to an issue.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Conventional commit PR title (e.g. 'fix(auth): prevent token cache race condition').",
        },
        body: {
          type: "string",
          description: "Comprehensive PR description with Changes, Motivation, Test Coverage, and 'Fixes #<issue_number>'.",
        },
        branchName: {
          type: "string",
          description: "Branch name to create (e.g. 'devrel/fix-token-race').",
        },
        issueNumber: {
          type: "string",
          description: "Optional issue number to link (e.g. '42').",
        },
      },
      required: ["title", "body", "branchName"],
    },
  },
  {
    name: "inspect_ci_status",
    description:
      "Inspect GitHub Actions CI check runs, status, and failure logs for a PR or commit SHA.",
    parameters: {
      type: "object",
      properties: {
        prNumber: {
          type: "string",
          description: "PR number to inspect check suites for.",
        },
      },
    },
  },
  {
    name: "inspect_pr_reviews",
    description:
      "Fetch maintainer review comments, requested changes, and inline review threads on a PR.",
    parameters: {
      type: "object",
      properties: {
        prNumber: {
          type: "string",
          description: "PR number to fetch review comments from.",
        },
      },
    },
  },
];

/**
 * Convert standard tool definitions to OpenAI / NVIDIA NIM tool schema
 */
export function toOpenAITools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: tool.parameters.type,
        properties: tool.parameters.properties,
        ...(tool.parameters.required ? { required: tool.parameters.required } : {}),
      },
    },
  }));
}
