"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { Bot, GitPullRequest, GitMerge, CheckCircle, Terminal as TerminalIcon } from "lucide-react";
import { FaGithub } from "react-icons/fa";

// Inline SVG data URI replaces external CDN dependency (transparenttextures.com)
const SUBTLE_GRID_BG = `url("data:image/svg+xml,%3Csvg width='40' height='40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h40v40H0z' fill='none'/%3E%3Cpath d='M40 0v40M0 0h40' stroke='%23ffffff' stroke-opacity='0.03' stroke-width='1'/%3E%3C/svg%3E")`;

interface LogEntry {
  id: string;
  time: string;
  type: string;
  text: string;
}

export default function DevRelAgent() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [issueUrl, setIssueUrl] = useState("");
  const [isRunning, setIsRunning] = useState(false);
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
    setIsRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: issueUrl }),
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
              setLogs(prev => [...prev, { ...data, id }]);
            } catch {
              // ignore parse errors for partial chunks
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : "Unknown error";
      setLogs(prev => [
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
  }, [issueUrl, isRunning]);

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9] font-sans relative">
      <div
        className="absolute inset-0 opacity-5 pointer-events-none"
        style={{ backgroundImage: SUBTLE_GRID_BG }}
        aria-hidden="true"
      />

      {/* Header */}
      <header className="flex items-center justify-between px-8 py-6 border-b border-[#30363d] bg-[#161b22] sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#238636] flex items-center justify-center">
            <Bot className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">DevRel Agent</h1>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/anujsinghcse"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm font-medium hover:text-white transition-colors"
          >
            <FaGithub className="h-5 w-5" />
            View Source
          </a>
          <button
            disabled
            title="GitHub App installation coming soon"
            className="bg-[#238636] hover:bg-[#2ea043] disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md font-medium text-sm transition-colors border border-[rgba(240,246,252,0.1)]"
          >
            Install GitHub App
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-20 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
        {/* Left: Copy */}
        <div className="space-y-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#30363d] bg-[#21262d] text-sm">
            <span className="w-2 h-2 rounded-full bg-[#3fb950] animate-pulse" aria-hidden="true" />
            Active on 450+ Repositories
          </div>

          <h2 className="text-5xl font-extrabold text-white leading-tight">
            The AI Maintainer <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#238636] to-[#2ea043]">
              You Always Wanted.
            </span>
          </h2>

          <p className="text-lg text-[#8b949e] max-w-lg">
            Stop wasting weekends triaging typos and dependency bumps.
            DevRel Agent autonomously reads issues, categorizes them, and drafts ready-to-merge Pull Requests.
          </p>

          <div className="flex items-center gap-2 mt-4 max-w-lg">
            <label htmlFor="issue-url-input" className="sr-only">
              GitHub Issue URL
            </label>
            <input
              id="issue-url-input"
              type="url"
              placeholder="Paste GitHub Issue URL here..."
              value={issueUrl}
              onChange={(e) => setIssueUrl(e.target.value)}
              aria-label="GitHub Issue URL"
              className="flex-1 bg-[#161b22] border border-[#30363d] rounded-md px-4 py-2 text-white text-sm focus:outline-none focus:border-[#58a6ff]"
            />
            <button
              onClick={runAgent}
              disabled={isRunning || !issueUrl}
              className="bg-[#238636] hover:bg-[#2ea043] disabled:opacity-50 text-white px-4 py-2 rounded-md font-medium text-sm transition-colors border border-[rgba(240,246,252,0.1)] whitespace-nowrap"
            >
              {isRunning ? "Running..." : "Run Agent"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-6 pt-4">
            <div className="border border-[#30363d] bg-[#161b22] p-5 rounded-xl">
              <GitPullRequest className="h-6 w-6 text-[#a371f7] mb-3" />
              <h3 className="font-bold text-white">Auto-PRs</h3>
              <p className="text-sm text-[#8b949e] mt-1">Generates fixes for typos and minor bugs automatically.</p>
            </div>
            <div className="border border-[#30363d] bg-[#161b22] p-5 rounded-xl">
              <GitMerge className="h-6 w-6 text-[#3fb950] mb-3" />
              <h3 className="font-bold text-white">Semantic Triage</h3>
              <p className="text-sm text-[#8b949e] mt-1">Labels and routes issues based on NLP intent matching.</p>
            </div>
          </div>
        </div>

        {/* Right: Terminal Demo */}
        <div className="relative">
          <div className="absolute -inset-1 bg-gradient-to-r from-[#238636] to-[#a371f7] rounded-2xl blur opacity-20" aria-hidden="true" />
          <div className="relative bg-[#010409] border border-[#30363d] rounded-2xl overflow-hidden shadow-2xl">
            {/* Window Bar */}
            <div className="flex items-center px-4 py-3 bg-[#161b22] border-b border-[#30363d]">
              <div className="flex gap-2" aria-hidden="true">
                <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
              </div>
              <div className="flex-1 text-center flex items-center justify-center gap-2 text-xs font-mono text-[#8b949e]">
                <TerminalIcon className="h-3 w-3" />
                worker-node-01
              </div>
            </div>

            {/* Terminal Body */}
            <div
              className="p-6 font-mono text-sm h-[380px] overflow-y-auto"
              role="log"
              aria-label="Agent execution log"
              aria-live="polite"
            >
              {logs.map((log) => (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  key={log.id}
                  className="mb-3 flex items-start gap-3"
                >
                  <span className="text-[#8b949e] shrink-0">[{log.time}]</span>
                  {log.type === "info" && <span className="text-[#58a6ff]">INFO</span>}
                  {log.type === "action" && <span className="text-[#d2a8ff]">EXEC</span>}
                  {log.type === "success" && <span className="text-[#3fb950] flex items-center gap-1"><CheckCircle className="h-3 w-3" /> DONE</span>}
                  {log.type === "error" && <span className="text-[#f85149]">ERR</span>}
                  <span className="text-[#c9d1d9]">{log.text}</span>
                </motion.div>
              ))}
              <div className="flex items-center gap-2 mt-4 animate-pulse text-[#8b949e]" aria-hidden="true">
                <span>_</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
