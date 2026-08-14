import { NextRequest } from "next/server";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

// In-memory sliding-window token bucket
const ipRequestMap = new Map<string, RateLimitRecord>();

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes window
const MAX_REQUESTS_PER_WINDOW = 10; // Max 10 runs per IP per 10 mins

export interface AuthValidationResult {
  allowed: boolean;
  status: number;
  reason?: string;
}

export function validateApiAccess(req: NextRequest): AuthValidationResult {
  // 1. Optional API Key verification if configured
  const configuredSecret = process.env.DEVREL_AGENT_API_KEY;
  if (configuredSecret) {
    const providedKey =
      req.headers.get("x-api-key") ||
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

    if (!providedKey || providedKey !== configuredSecret) {
      return {
        allowed: false,
        status: 401,
        reason: "Unauthorized: Invalid or missing API key (x-api-key header required).",
      };
    }
  }

  // 2. Origin & Host validation in production
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  const referer = req.headers.get("referer");

  // In production, block cross-site forged POST requests
  if (process.env.NODE_ENV === "production" && host) {
    if (origin) {
      const originHost = origin.replace(/^https?:\/\//, "");
      if (originHost !== host) {
        return {
          allowed: false,
          status: 403,
          reason: "Forbidden: Origin does not match request host.",
        };
      }
    } else if (referer) {
      const refererHost = referer.replace(/^https?:\/\//, "").split("/")[0];
      if (refererHost !== host) {
        return {
          allowed: false,
          status: 403,
          reason: "Forbidden: Referer does not match request host.",
        };
      }
    }
  }

  // 3. In-memory Rate Limiting per IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1";

  const now = Date.now();
  const record = ipRequestMap.get(ip);

  if (!record || now > record.resetAt) {
    ipRequestMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    if (record.count >= MAX_REQUESTS_PER_WINDOW) {
      const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
      return {
        allowed: false,
        status: 429,
        reason: `Rate limit exceeded: Max ${MAX_REQUESTS_PER_WINDOW} requests per 10 minutes. Retry after ${retryAfterSec}s.`,
      };
    }
    record.count += 1;
  }

  return { allowed: true, status: 200 };
}
