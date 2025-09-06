// src/server/redis.ts

import { env } from "../env/server.mjs";

// Edge-compatible in-memory rate limiter
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL = 60000; // 1 minute
let lastCleanup = 0;

// Clean up expired entries
function cleanupExpiredEntries() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  const windowMs = 60000; // 1 minute window
  const cutoff = now - windowMs;

  for (const [key, entry] of rateLimitMap.entries()) {
    if (entry.windowStart < cutoff) {
      rateLimitMap.delete(key);
    }
  }

  lastCleanup = now;
}

// Edge-compatible rate limiting
async function checkRateLimit(id: string, limit: number = 100, windowMinutes: number = 1): Promise<boolean> {
  try {
    cleanupExpiredEntries();

    const now = Date.now();
    const windowMs = windowMinutes * 60 * 1000;
    const windowStart = now - windowMs;

    const existing = rateLimitMap.get(id);

    if (!existing || existing.windowStart < windowStart) {
      // First request in window or expired window
      rateLimitMap.set(id, { count: 1, windowStart: now });
      return true;
    }

    if (existing.count >= limit) {
      return false; // Rate limit exceeded
    }

    // Increment count
    existing.count += 1;
    rateLimitMap.set(id, existing);

    return true;
  } catch (error) {
    console.error("Rate limit check failed:", error);
    // On error, allow request to prevent blocking legitimate traffic
    return true;
  }
}

export const isAllowed = async (id: string) => {
  const requestsPerMinute = env.RATE_LIMITER_REQUESTS_PER_MINUTE ?? 100;
  return await checkRateLimit(id, requestsPerMinute, 1);
};