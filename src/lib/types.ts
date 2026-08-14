export type AgentMode = "issue_fix" | "elite_pr_contributor" | "pr_merger_autopilot";

export type LogType = "phase" | "info" | "action" | "success" | "error" | "monitor" | "ci_status";

export interface AgentRequestBody {
  url?: string;
  mode?: AgentMode;
  reviewComments?: string;
  ciLogs?: string;
  userGithubToken?: string;
  dryRun?: boolean;
}

export interface CommentAnalysis {
  comment: string;
  classification: "Blocking" | "Major" | "Minor" | "Style" | "CI" | "Documentation";
  root_cause: string;
  exact_location: string;
  expected_behavior: string;
  current_behavior: string;
  request_type: "code" | "tests" | "documentation" | "cleanup" | "architectural";
}

export interface Phase1Result {
  intent: string;
  confidence: number;
  file_paths: string[];
  test_file_paths?: string[];
  project_language: string;
  comments_analysis: CommentAnalysis[];
  resolution_plan: string;
}

export interface Phase3Result {
  test_framework: string;
  test_file_name: string;
  test_code: string;
  cases_covered: string[];
}

export interface Phase4Result {
  passed: boolean;
  audit_notes: string[];
  verdict: string;
}

export interface SatisfactionItem {
  comment: string;
  classification: string;
  status: string;
  evidence: string;
  testCoverage: string;
}

export interface FinalResultPayload {
  prUrl: string;
  satisfactionMatrix: SatisfactionItem[];
  prResponseText: string;
  regressionTest: Phase3Result;
  diffAudit: Phase4Result;
  filesModified?: string[];
  isDryRun?: boolean;
  generatedCode?: { path: string; content: string }[];
}

export interface LogEvent {
  time: string;
  type: "phase" | "info" | "action" | "success" | "error" | "monitor" | "ci_status" | "result";
  text: string;
  payload?: unknown;
}
