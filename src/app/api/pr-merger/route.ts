import { NextRequest, NextResponse } from "next/server";
import { validateApiAccess } from "@/lib/auth";
import { runPRMergerLoop } from "@/lib/pr-merger-agent";
import { LogType } from "@/lib/types";
import { PRMergerRequestSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  const auth = validateApiAccess(req);
  if (!auth.allowed) {
    return NextResponse.json(
      { error: auth.reason || "Access denied" },
      { status: auth.status }
    );
  }

  let rawJson: unknown;
  try {
    rawJson = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request JSON." }, { status: 400 });
  }

  const parsedBody = PRMergerRequestSchema.safeParse(rawJson);
  if (!parsedBody.success) {
    const errorMsg = parsedBody.error.issues.map((i) => i.message).join(", ");
    return NextResponse.json({ error: `Validation Error: ${errorMsg}` }, { status: 400 });
  }

  const { prUrl, userGithubToken, maxCycles = 5, autoMergeIfReady = true } = parsedBody.data;

  const encoder = new TextEncoder();
  const userToken =
    userGithubToken?.trim() || req.headers.get("x-github-token")?.trim() || undefined;


  const stream = new ReadableStream({
    async start(controller) {
      const sendLog = (type: LogType, text: string, payload?: Record<string, unknown>) => {
        const data = JSON.stringify({
          id: Math.random().toString(36).substring(7),
          time: new Date().toLocaleTimeString(),
          type,
          text,
          ...(payload ? { payload } : {}),
        });
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      try {
        const result = await runPRMergerLoop(
          {
            prUrl,
            userToken,
            maxCycles,
            autoMergeIfReady,
          },
          (type, text) => sendLog(type, text)
        );

        sendLog("success", result.summary, { result });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        sendLog("error", `PR Autopilot error: ${errorMsg}`);
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
