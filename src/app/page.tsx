"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  GitPullRequest,
  GitMerge,
  CheckCircle,
  Terminal as TerminalIcon,
  ArrowRight,
  Zap,
  ShieldCheck,
  Code2,
  Sparkles,
} from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

interface LogEntry {
  id: string;
  time: string;
  type: string;
  text: string;
}

const easeOut = [0.16, 1, 0.3, 1] as const;

const fadeInUp = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: easeOut } },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12, delayChildren: 0.1 } },
};

interface SatisfactionItem {
  comment: string;
  classification: string;
  status: string;
  evidence: string;
  testCoverage: string;
}

interface FinalResultPayload {
  prUrl: string;
  satisfactionMatrix: SatisfactionItem[];
  prResponseText: string;
  regressionTest: {
    test_framework: string;
    test_file_name: string;
    test_code: string;
    cases_covered: string[];
  };
  diffAudit: {
    passed: boolean;
    audit_notes: string[];
    verdict: string;
  };
}

export default function DevRelAgent() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [issueUrl, setIssueUrl] = useState("");
  const [agentMode, setAgentMode] = useState<"elite_pr_contributor" | "issue_fix">("elite_pr_contributor");
  const [reviewComments, setReviewComments] = useState("");
  const [ciLogs, setCiLogs] = useState("");
  const [showAdvancedInputs, setShowAdvancedInputs] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [finalResult, setFinalResult] = useState<FinalResultPayload | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const logIdRef = useRef(0);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const runAgent = useCallback(async () => {
    if (!issueUrl || isRunning) return;
    setLogs([]);
    setFinalResult(null);
    setIsRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: issueUrl,
          mode: agentMode,
          reviewComments,
          ciLogs
        }),
        signal: controller.signal,
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.substring(6));
              const id = `log-${++logIdRef.current}`;
              if (data.type === "result" && data.payload) {
                setFinalResult(data.payload);
              }
              setLogs((prev) => [...prev, { ...data, id }]);
            } catch {
              // ignore parse errors for partial chunks
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : "Unknown error";
      setLogs((prev) => [
        ...prev,
        {
          id: `log-${++logIdRef.current}`,
          time: new Date().toLocaleTimeString(),
          type: "error",
          text: `Stream error: ${message}`,
        },
      ]);
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [issueUrl, agentMode, reviewComments, ciLogs, isRunning]);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans relative selection:bg-accent selection:text-white">

      {/* Navigation Bar */}
      <header className="sticky top-0 z-50 border-b border-border bg-white/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center shadow-accent text-white font-bold">
              <Bot className="h-5 w-5" />
            </div>
            <span className="font-serif font-normal text-2xl tracking-tight text-foreground">
              DevRel<span className="gradient-text">.Agent</span>
            </span>
          </div>

          <div className="flex items-center gap-4">
            <a
              href="https://github.com/anujsinghcse"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <FaGithub className="h-5 w-5" />
              <span>GitHub</span>
            </a>
            <Button variant="outline" disabled title="Coming soon">
              Install App
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative py-16 lg:py-24 px-6 overflow-hidden">
        {/* Background Ambient Glow */}
        <div className="absolute top-10 right-10 w-96 h-96 rounded-full bg-accent/5 blur-[140px] pointer-events-none" />

        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-12 items-start"
        >
          {/* Left Column: Hero Text & Controls */}
          <motion.div variants={fadeInUp} className="space-y-6">
            <Badge pulse>Elite PR Merge Engine</Badge>

            <h1 className="font-serif text-4xl sm:text-5xl lg:text-[4.5rem] leading-[1.05] tracking-tight text-foreground">
              The Open-Source <br />
              <span className="relative inline-block mt-1">
                <span className="gradient-text">Contributor Agent.</span>
                <span className="gradient-underline" />
              </span>
            </h1>

            <p className="text-base md:text-lg text-muted-foreground leading-relaxed max-w-xl">
              Not just solving issues—getting PRs merged. Executes a 7-phase workflow: Review Analysis, Implementation, Regression Testing, Diff Audit, CI Compliance, Satisfaction Check &amp; PR Response.
            </p>

            {/* Mode Switcher */}
            <div className="flex items-center gap-2 p-1.5 rounded-xl bg-muted border border-border w-fit">
              <button
                type="button"
                onClick={() => setAgentMode("elite_pr_contributor")}
                className={`px-4 py-2 rounded-lg font-medium text-xs sm:text-sm transition-all flex items-center gap-2 ${
                  agentMode === "elite_pr_contributor"
                    ? "bg-white text-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Sparkles className="h-4 w-4 text-accent" />
                <span>Elite PR Contributor (7-Phase)</span>
              </button>
              <button
                type="button"
                onClick={() => setAgentMode("issue_fix")}
                className={`px-4 py-2 rounded-lg font-medium text-xs sm:text-sm transition-all flex items-center gap-2 ${
                  agentMode === "issue_fix"
                    ? "bg-white text-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Zap className="h-4 w-4 text-amber-500" />
                <span>Issue Auto-Fixer</span>
              </button>
            </div>

            {/* Interactive Issue/PR URL Form */}
            <div className="space-y-3 pt-2 max-w-xl">
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <Input
                  type="url"
                  placeholder={agentMode === "elite_pr_contributor" ? "Paste GitHub PR or Issue URL..." : "Paste GitHub Issue URL..."}
                  value={issueUrl}
                  onChange={(e) => setIssueUrl(e.target.value)}
                  aria-label="GitHub Issue or PR URL"
                />
                <Button
                  onClick={runAgent}
                  disabled={isRunning || !issueUrl}
                  className="w-full sm:w-auto shrink-0"
                >
                  {isRunning ? (
                    <>
                      <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      <span>Executing...</span>
                    </>
                  ) : (
                    <>
                      <span>Execute Workflow</span>
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </>
                  )}
                </Button>
              </div>

              {/* Toggle Optional Review Inputs */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvancedInputs(!showAdvancedInputs)}
                  className="text-xs text-accent font-semibold hover:underline flex items-center gap-1"
                >
                  {showAdvancedInputs ? "− Hide Maintainer Feedback & CI Logs" : "+ Add Maintainer Review Comments & CI Logs"}
                </button>

                {showAdvancedInputs && (
                  <div className="mt-3 space-y-3 p-4 rounded-xl bg-slate-50 border border-border">
                    <div>
                      <label className="block font-mono text-xs font-semibold text-foreground mb-1">
                        Maintainer / CodeRabbit Review Comments
                      </label>
                      <textarea
                        rows={3}
                        value={reviewComments}
                        onChange={(e) => setReviewComments(e.target.value)}
                        placeholder="Paste reviewer feedback (e.g. 'Prompt should not reference missing tool', 'Fix edge case in auth middleware')..."
                        className="w-full text-xs font-mono p-2.5 rounded-lg border border-border bg-white text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block font-mono text-xs font-semibold text-foreground mb-1">
                        CI Failure Logs (Optional)
                      </label>
                      <textarea
                        rows={2}
                        value={ciLogs}
                        onChange={(e) => setCiLogs(e.target.value)}
                        placeholder="Paste build/test failure log trace..."
                        className="w-full text-xs font-mono p-2.5 rounded-lg border border-border bg-white text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Micro Stats Row */}
            <div className="flex items-center gap-8 pt-4 border-t border-border/60">
              <div>
                <div className="font-serif text-2xl font-bold text-foreground">7 Phases</div>
                <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mt-0.5">Merge Pipeline</div>
              </div>
              <div className="h-8 w-px bg-border" />
              <div>
                <div className="font-serif text-2xl font-bold text-accent">100%</div>
                <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mt-0.5">Regression Test Target</div>
              </div>
              <div className="h-8 w-px bg-border" />
              <div>
                <div className="font-serif text-2xl font-bold text-foreground">Zero</div>
                <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mt-0.5">Stale Logs Allowed</div>
              </div>
            </div>
          </motion.div>

          {/* Right Column: Live Execution Terminal */}
          <motion.div variants={fadeInUp} className="relative">
            <div className="absolute -inset-2 bg-gradient-to-r from-[#0052FF] to-[#4D7CFF] rounded-3xl blur-xl opacity-20" />

            <Card variant="dark" className="relative z-10">
              {/* Terminal Header */}
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-[#FF5F56]" />
                  <span className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
                  <span className="w-3 h-3 rounded-full bg-[#27C93F]" />
                </div>
                <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
                  <TerminalIcon className="h-3.5 w-3.5 text-[#0052FF]" />
                  <span>contributor-agent-v2</span>
                </div>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-mono text-[10px] uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Stream
                </span>
              </div>

              {/* Terminal Logs Window */}
              <div
                className="font-mono text-xs h-[380px] overflow-y-auto space-y-3 pr-2 scrollbar-thin"
                role="log"
                aria-label="Agent execution log"
              >
                {logs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3 text-center px-4">
                    <Code2 className="h-8 w-8 text-slate-600 animate-bounce" />
                    <p className="text-slate-400 font-sans text-sm">
                      Ready for action. Enter a PR or Issue URL and click <strong className="text-white">Execute Workflow</strong>.
                    </p>
                  </div>
                ) : (
                  logs.map((log) => (
                    <motion.div
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      key={log.id}
                      className="flex items-start gap-2.5"
                    >
                      <span className="text-slate-500 shrink-0">[{log.time}]</span>
                      {log.type === "phase" && (
                        <span className="text-cyan-400 font-bold shrink-0 bg-cyan-950 px-1.5 py-0.5 rounded border border-cyan-800">PHASE</span>
                      )}
                      {log.type === "info" && (
                        <span className="text-[#4D7CFF] font-semibold shrink-0">INFO</span>
                      )}
                      {log.type === "action" && (
                        <span className="text-purple-400 font-semibold shrink-0">EXEC</span>
                      )}
                      {log.type === "success" && (
                        <span className="text-emerald-400 font-semibold flex items-center gap-1 shrink-0">
                          <CheckCircle className="h-3 w-3" /> DONE
                        </span>
                      )}
                      {log.type === "error" && (
                        <span className="text-rose-400 font-semibold shrink-0">ERR</span>
                      )}
                      {log.type === "monitor" && (
                        <span className="text-amber-400 font-semibold flex items-center gap-1 shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />WATCH
                        </span>
                      )}
                      {log.type === "ci_status" && (
                        <span className="text-teal-400 font-bold shrink-0 bg-teal-950 px-1.5 py-0.5 rounded border border-teal-800">CI</span>
                      )}
                      <span className={`break-all ${log.type === "phase" ? "text-cyan-200 font-semibold" : log.type === "ci_status" ? "text-teal-200 font-semibold" : log.type === "monitor" ? "text-amber-200" : "text-slate-200"}`}>{log.text}</span>
                    </motion.div>
                  ))
                )}
              </div>
            </Card>
          </motion.div>
        </motion.div>
      </section>

      {/* Maintainer Satisfaction Check & Results Section */}
      {finalResult && (
        <section className="py-12 px-6 bg-slate-900 text-white border-t border-slate-800">
          <div className="max-w-6xl mx-auto space-y-8">
            <div className="flex items-center justify-between">
              <div>
                <Badge pulse={false}>Phase 6 &amp; Phase 7 Verification</Badge>
                <h2 className="font-serif text-3xl text-white mt-2">Maintainer Satisfaction &amp; Response Matrix</h2>
              </div>
              {finalResult.prUrl && (
                <a
                  href={finalResult.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl gradient-bg text-white font-medium text-sm flex items-center gap-2 hover:opacity-90 transition-opacity"
                >
                  <span>View PR on GitHub</span>
                  <ArrowRight className="h-4 w-4" />
                </a>
              )}
            </div>

            {/* Matrix Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase">
                    <th className="py-3 px-4">Review Comment</th>
                    <th className="py-3 px-4">Classification</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Evidence</th>
                    <th className="py-3 px-4">Test Coverage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {finalResult.satisfactionMatrix?.map((row: SatisfactionItem, i: number) => (
                    <tr key={i} className="hover:bg-slate-900/40">
                      <td className="py-3 px-4 text-slate-200 font-sans">{row.comment}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30">
                          {row.classification}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                          {row.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300 font-sans">{row.evidence}</td>
                      <td className="py-3 px-4 text-cyan-300">{row.testCoverage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Generated Maintainer Response Box */}
            <div className="p-6 rounded-xl border border-slate-800 bg-slate-950 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <span className="font-mono text-xs text-slate-400 font-semibold uppercase">Phase 7: Generated Maintainer Response</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(finalResult.prResponseText)}
                  className="text-xs text-accent hover:underline font-mono"
                >
                  Copy Response Markdown
                </button>
              </div>
              <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed bg-slate-900 p-4 rounded-lg border border-slate-850">
                {finalResult.prResponseText}
              </pre>
            </div>
          </div>
        </section>
      )}


      {/* Feature Capabilities Grid Section */}
      <section className="py-28 px-6 bg-muted/50 border-y border-border">
        <div className="max-w-6xl mx-auto space-y-16">
          <div className="text-center max-w-2xl mx-auto space-y-4">
            <Badge pulse={false}>Core Engine</Badge>
            <h2 className="font-serif text-4xl sm:text-5xl text-foreground">
              Built for High-Velocity Engineering Teams
            </h2>
            <p className="text-muted-foreground">
              Combining LLM reasoning with automated git worktree isolation to deliver clean, reviewable PRs.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card variant="gradient-border">
              <div className="w-12 h-12 rounded-xl gradient-bg flex items-center justify-center text-white mb-6 shadow-accent">
                <GitPullRequest className="h-6 w-6" />
              </div>
              <h3 className="font-sans font-semibold text-xl text-foreground mb-2">
                Automated Fix Generation
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Parses bug reports, locates target files, generates minimal diffs, and opens clean Pull Requests directly.
              </p>
            </Card>

            <Card variant="standard">
              <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent mb-6">
                <GitMerge className="h-6 w-6" />
              </div>
              <h3 className="font-sans font-semibold text-xl text-foreground mb-2">
                Semantic Issue Triage
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Classifies incoming issues by severity, intent, and domain area using structured NLP model pipelines.
              </p>
            </Card>

            <Card variant="standard">
              <div className="w-12 h-12 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent mb-6">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <h3 className="font-sans font-semibold text-xl text-foreground mb-2">
                Sandboxed Safety Gates
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                All generated code runs through local linter, build, and test verification before PR creation.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* Inverted Slate Contrast Section */}
      <section className="py-28 px-6 bg-[#0F172A] text-white relative overflow-hidden dot-pattern-dark">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
          <div className="space-y-6">
            <Badge pulse>Continuous Workflow</Badge>
            <h2 className="font-serif text-4xl sm:text-5xl text-white leading-tight">
              From GitHub Issue <br />
              to Merged PR in <span className="gradient-text">Minutes</span>
            </h2>
            <p className="text-slate-300 leading-relaxed">
              No manual branch setup required. DevRel Agent monitors webhooks, creates isolated environments, and drafts precise PRs with full context logs.
            </p>
            <div className="pt-4 flex flex-col gap-4">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center font-bold text-sm">
                  1
                </div>
                <span className="text-sm text-slate-200">Issue Webhook Triggered</span>
              </div>
              <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center font-bold text-sm">
                  2
                </div>
                <span className="text-sm text-slate-200">AI Analyzes Codebase &amp; AST</span>
              </div>
              <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center font-bold text-sm">
                  3
                </div>
                <span className="text-sm text-slate-200">Verified PR Opened Automatically</span>
              </div>
            </div>
          </div>

          <div className="relative flex justify-center">
            <div className="w-72 h-72 sm:w-96 sm:h-96 rounded-full border border-slate-700/50 flex items-center justify-center relative animate-spin [animation-duration:60s]">
              <div className="w-56 h-56 rounded-full border border-dashed border-accent/40" />
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-accent shadow-accent" />
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
              <Sparkles className="h-10 w-10 text-accent mb-2" />
              <div className="font-serif text-3xl font-bold text-white">99.8%</div>
              <div className="text-xs font-mono text-slate-400 uppercase tracking-widest mt-1">Uptime Reliability</div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-border bg-white text-muted-foreground text-sm">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-serif font-bold text-foreground text-lg">DevRel.Agent</span>
            <span>&copy; {new Date().getFullYear()} All rights reserved.</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://github.com/anujsinghcse" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
              GitHub Repo
            </a>
            <a href="/api/agent" className="hover:text-foreground transition-colors">
              API Specs
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
