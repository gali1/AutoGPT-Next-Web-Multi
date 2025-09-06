// src/middleware.ts

import type { NextRequest } from "next/server";
import { ipAddress } from "@vercel/edge";
import { isAllowed } from "./server/redis";

export const config = {
  // Only run the middleware on agent routes
  matcher: "/api/agent/:path*",
};

function ipFallback(request: Request) {
  const xff = request.headers.get("x-forwarded-for");
  return xff
    ? Array.isArray(xff)
      ? (xff[0] as string)
      : xff.split(",")[0]
    : "127.0.0.1";
}

async function shouldRateLimit(request: NextRequest): Promise<boolean> {
  try {
    const ip = ipAddress(request) || ipFallback(request);
    if (!ip) {
      return false;
    }

    return !(await isAllowed(ip));
  } catch (error) {
    console.error("Rate limiting check failed:", error);
    // On error, allow request to prevent blocking legitimate traffic
    return false;
  }
}

const rateLimitedResponse = () =>
  new Response("Too many requests, please try again later.", {
    status: 429,
    headers: {
      "Content-Type": "text/plain",
      "Retry-After": "60",
    },
  });

// noinspection JSUnusedGlobalSymbols
export async function middleware(request: NextRequest) {
  if (await shouldRateLimit(request)) {
    return rateLimitedResponse();
  }
}