import { NextRequest, NextResponse } from "next/server";
import { validateApiAccess } from "@/lib/auth";
import { runPRMergerLoop } from "@/lib/pr-merger-agent";
import { LogType } from "@/lib/types";

export async function POST(req: NextRequest) {
  const auth = validateApiAccess(req);
  if (!auth.allowed) {
    return NextResponse.json(
      { error: auth.reason || "Access denied" },
      { status: auth.status }
    );
  }

  let body: {
    prUrl: string;
    userGithubToken?: string;
    maxCycles?: number;
    autoMergeIfReady?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request JSON" }, { status: 400 });
  }

  const { prUrl, userGithubToken, maxCycles = 5, autoMergeIfReady = true } = body;
  if (!prUrl) {
    return NextResponse.json({ error: "prUrl is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const userToken =
    userGithubToken?.trim() || req.headers.get("x-github-token")?.trim() || undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      const log = (type: LogType, text: string) => {
        sendEvent("log", {
          id: Math.random().toString(36).substring(7),
          time: new Date().toLocaleTimeString(),
          type,
          text,
        });
      };

      try {
        const result = await runPRMergerLoop(
          {
            prUrl,
            userToken,
            maxCycles,
            autoMergeIfReady,
          },
          log
        );

        sendEvent("done", {
          merged: result.merged,
          state: result.state,
          prUrl: result.prUrl,
          totalCommitsPushed: result.totalCommitsPushed,
          cyclesExecuted: result.cyclesExecuted,
          summary: result.summary,
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        log("error", `PR Autopilot failed: ${errorMsg}`);
        sendEvent("error", { message: errorMsg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
