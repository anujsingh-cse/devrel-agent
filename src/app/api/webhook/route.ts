import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get("x-hub-signature-256");
    const event = req.headers.get("x-github-event");
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    const rawBody = await req.text();

    // Verify webhook signature if secret is configured
    if (secret && signature) {
      const expectedSignature = `sha256=${crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex")}`;
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const payload = JSON.parse(rawBody);

    // 1. Issue Created Event
    if (event === "issues" && (payload.action === "opened" || payload.action === "labeled")) {
      const issueUrl = payload.issue?.html_url;
      const isDevRelTrigger =
        payload.action === "opened" ||
        payload.issue?.labels?.some((l: { name: string }) =>
          l.name.toLowerCase().includes("devrel") || l.name.toLowerCase().includes("auto-fix")
        );

      if (issueUrl && isDevRelTrigger) {
        // Trigger agent execution in background (fire-and-forget or internal fetch)
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        fetch(`${appUrl}/api/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        fetch(`${appUrl}/api/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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

    return NextResponse.json({ status: "ignored", event });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown webhook error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
