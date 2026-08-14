import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { constantTimeCompare } from "@/lib/auth";

const MAX_WEBHOOK_BODY_BYTES = 5 * 1024 * 1024; // 5MB limit

export async function GET() {
  const secretConfigured = Boolean(process.env.GITHUB_WEBHOOK_SECRET);
  return NextResponse.json({
    service: "DevRel Agent Autonomous GitHub Webhook",
    status: "active",
    secretConfigured,
    supportedEvents: ["issues.opened", "issues.labeled", "pull_request_review.submitted"],
    contentType: "application/json",
    setupInstructions:
      "In GitHub Repository > Settings > Webhooks > Add webhook. Set Payload URL to https://your-domain.com/api/webhook with Content type application/json.",
  });
}

export async function POST(req: NextRequest) {

  try {
    const signature = req.headers.get("x-hub-signature-256");
    const event = req.headers.get("x-github-event");
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    // Reject immediately if webhook secret is not configured to prevent unauthenticated trigger
    if (!secret) {
      return NextResponse.json(
        {
          error:
            "Webhook secret not configured on server. Set GITHUB_WEBHOOK_SECRET in .env.local to enable webhooks.",
        },
        { status: 503 }
      );
    }

    if (!signature) {
      return NextResponse.json(
        { error: "Missing x-hub-signature-256 header." },
        { status: 401 }
      );
    }

    // Limit body read size
    const rawBody = await req.text();
    if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    }

    // Verify HMAC-SHA256 signature using constant-time comparison
    const expectedSignature = `sha256=${crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex")}`;

    if (!constantTimeCompare(signature, expectedSignature)) {
      return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
    }

    let payload: Record<string, any>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const agentApiKey = process.env.DEVREL_AGENT_API_KEY;
    const internalHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(agentApiKey ? { "x-api-key": agentApiKey } : {}),
    };

    // 1. Issue Created Event
    if (event === "issues" && (payload.action === "opened" || payload.action === "labeled")) {
      const issueUrl = payload.issue?.html_url;
      const isDevRelTrigger =
        payload.action === "opened" ||
        payload.issue?.labels?.some((l: { name: string }) =>
          l.name.toLowerCase().includes("devrel") || l.name.toLowerCase().includes("auto-fix")
        );

      if (issueUrl && isDevRelTrigger) {
        // Trigger agent execution
        fetch(`${appUrl}/api/agent`, {
          method: "POST",
          headers: internalHeaders,
          body: JSON.stringify({
            url: issueUrl,
            mode: "issue_fix",
          }),
        }).catch((err) => console.error("Webhook trigger agent error:", err));

        return NextResponse.json({
          status: "triggered",
          event: "issues.opened",
          issueUrl,
        });
      }
    }

    // 2. PR Review Submitted Event
    if (event === "pull_request_review" && payload.action === "submitted") {
      const prUrl = payload.pull_request?.html_url;
      const reviewComments = payload.review?.body || "";
      const reviewState = payload.review?.state;

      if (prUrl && reviewState === "changes_requested") {
        fetch(`${appUrl}/api/agent`, {
          method: "POST",
          headers: internalHeaders,
          body: JSON.stringify({
            url: prUrl,
            mode: "elite_pr_contributor",
            reviewComments,
          }),
        }).catch((err) => console.error("Webhook trigger agent PR error:", err));

        return NextResponse.json({
          status: "triggered",
          event: "pull_request_review.submitted",
          prUrl,
        });
      }
    }

    return NextResponse.json({ status: "ignored", event: event || "unknown" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal webhook error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
