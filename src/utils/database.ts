// src/utils/database.ts

import { v4 as uuidv4 } from "uuid";

// Client-side database utilities using API calls and browser storage

const SESSION_STORAGE_KEY = 'autogpt_session_token';
const COOKIE_STORAGE_KEY = 'autogpt_cookie_id';
const LOCAL_CACHE_KEY = 'autogpt_session_cache';

interface SessionData {
  sessionToken: string;
  cookieId?: string;
  createdAt: string;
  lastAccessed: string;
  metadata?: Record<string, any>;
}

interface QueryResponseData {
  query: string;
  response: string;
  createdAt: string;
  metadata?: Record<string, any>;
}

interface TokenStatus {
  tokensUsed: number;
  tokensRemaining: number;
  resetAt: string;
  timeUntilReset: number;
  canUseTokens: boolean;
}

interface SessionCache {
  session: SessionData;
  queryResponses: QueryResponseData[];
  tokenStatus?: TokenStatus;
  lastSync: string;
}

// Session management
export function getSessionToken(): string {
  if (typeof window === 'undefined') return '';

  let sessionToken = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!sessionToken) {
    sessionToken = uuidv4();
    sessionStorage.setItem(SESSION_STORAGE_KEY, sessionToken);
  }
  return sessionToken;
}

export function getCookieId(): string {
  if (typeof window === 'undefined') return '';

  let cookieId = localStorage.getItem(COOKIE_STORAGE_KEY);
  if (!cookieId) {
    cookieId = uuidv4();
    localStorage.setItem(COOKIE_STORAGE_KEY, cookieId);
  }
  return cookieId;
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;

  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  localStorage.removeItem(COOKIE_STORAGE_KEY);
  localStorage.removeItem(LOCAL_CACHE_KEY);
}

// Local cache management
function getLocalCache(): SessionCache | null {
  if (typeof window === 'undefined') return null;

  try {
    const cached = localStorage.getItem(LOCAL_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error('Failed to parse local cache:', error);
    return null;
  }
}

function setLocalCache(cache: SessionCache): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error('Failed to save local cache:', error);
  }
}

// API call utilities
async function apiCall(endpoint: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(endpoint, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API call failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Token management
export async function initializeTokens(sessionToken?: string, cookieId?: string): Promise<TokenStatus | null> {
  try {
    const token = sessionToken || getSessionToken();
    const cookie = cookieId || getCookieId();

    const result = await apiCall('/api/tokens/manage', {
      method: 'POST',
      body: JSON.stringify({
        sessionToken: token,
        cookieId: cookie,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        ipAddress: '', // Client-side can't get real IP
        metadata: {
          platform: typeof navigator !== 'undefined' ? navigator.platform : '',
          language: typeof navigator !== 'undefined' ? navigator.language : '',
        },
      }),
    });

    // Update local cache
    const cache = getLocalCache();
    if (cache) {
      cache.tokenStatus = result;
      setLocalCache(cache);
    }

    return result;
  } catch (error) {
    console.error('Failed to initialize tokens:', error);
    return null;
  }
}

export async function getTokenStatus(sessionToken?: string): Promise<TokenStatus | null> {
  try {
    const token = sessionToken || getSessionToken();

    // Check local cache first
    const cache = getLocalCache();
    if (cache?.tokenStatus && cache.session.sessionToken === token) {
      // Check if cache is recent (less than 30 seconds old)
      const cacheAge = Date.now() - new Date(cache.lastSync).getTime();
      if (cacheAge < 30000) {
        return cache.tokenStatus;
      }
    }

    const result = await apiCall(`/api/tokens/manage?sessionToken=${encodeURIComponent(token)}`);

    // Update local cache
    if (cache) {
      cache.tokenStatus = result;
      cache.lastSync = new Date().toISOString();
      setLocalCache(cache);
    }

    return result;
  } catch (error) {
    console.error('Failed to get token status:', error);

    // Return cached data if available
    const cache = getLocalCache();
    return cache?.tokenStatus || null;
  }
}

export async function consumeTokens(
  tokensToConsume: number,
  sessionToken?: string,
  metadata: Record<string, any> = {}
): Promise<{ success: boolean; tokensRemaining: number; error?: string }> {
  try {
    const token = sessionToken || getSessionToken();

    const result = await apiCall('/api/tokens/manage', {
      method: 'PUT',
      body: JSON.stringify({
        sessionToken: token,
        tokensToConsume,
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString(),
        },
      }),
    });

    // Update local cache
    const cache = getLocalCache();
    if (cache) {
      cache.tokenStatus = {
        tokensUsed: result.tokensUsed,
        tokensRemaining: result.tokensRemaining,
        resetAt: result.resetAt,
        timeUntilReset: new Date(result.resetAt).getTime() - Date.now(),
        canUseTokens: result.tokensRemaining > 0,
      };
      cache.lastSync = new Date().toISOString();
      setLocalCache(cache);
    }

    return {
      success: true,
      tokensRemaining: result.tokensRemaining,
    };
  } catch (error) {
    console.error('Failed to consume tokens:', error);

    // Check if it's an insufficient tokens error
    if (error instanceof Error && error.message.includes('403')) {
      return {
        success: false,
        tokensRemaining: 0,
        error: 'Insufficient tokens',
      };
    }

    return {
      success: false,
      tokensRemaining: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Database operations
export async function createSession(sessionToken?: string, cookieId?: string, metadata: Record<string, any> = {}): Promise<boolean> {
  try {
    const token = sessionToken || getSessionToken();
    const cookie = cookieId || getCookieId();

    const result = await apiCall('/api/database/session', {
      method: 'POST',
      body: JSON.stringify({
        sessionToken: token,
        cookieId: cookie,
        metadata,
      }),
    });

    // Initialize tokens for new session
    await initializeTokens(token, cookie);

    // Update local storage
    sessionStorage.setItem(SESSION_STORAGE_KEY, token);
    localStorage.setItem(COOKIE_STORAGE_KEY, cookie);

    return result.success;
  } catch (error) {
    console.error('Failed to create session:', error);
    return false;
  }
}

export async function saveQueryResponse(
  sessionToken: string,
  query: string,
  response: string,
  metadata: Record<string, any> = {}
): Promise<boolean> {
  try {
    // Estimate token consumption (rough approximation)
    const estimatedTokens = Math.ceil((query.length + response.length) / 4);

    // Check if user has enough tokens before saving
    const tokenStatus = await getTokenStatus(sessionToken);
    if (tokenStatus && !tokenStatus.canUseTokens) {
      throw new Error('No tokens remaining');
    }

    // Save to local cache first for immediate access
    const cache = getLocalCache();
    const queryResponse: QueryResponseData = {
      query,
      response,
      createdAt: new Date().toISOString(),
      metadata: {
        ...metadata,
        estimatedTokens,
      },
    };

    if (cache) {
      cache.queryResponses.push(queryResponse);
      cache.lastSync = new Date().toISOString();
      setLocalCache(cache);
    }

    // Save to remote database
    const result = await apiCall('/api/database/session', {
      method: 'PUT',
      body: JSON.stringify({
        sessionToken,
        query,
        response,
        metadata: {
          ...metadata,
          estimatedTokens,
        },
      }),
    });

    return result.success;
  } catch (error) {
    console.error('Failed to save query response:', error);
    return true; // Still return true if local cache was updated
  }
}

export async function getSessionHistory(sessionToken: string): Promise<QueryResponseData[]> {
  try {
    // Try local cache first
    const cache = getLocalCache();
    if (cache && cache.session.sessionToken === sessionToken) {
      return cache.queryResponses;
    }

    // Fetch from remote database
    const result = await apiCall(`/api/database/session?sessionToken=${encodeURIComponent(sessionToken)}`);

    // Update local cache
    const newCache: SessionCache = {
      session: result.session,
      queryResponses: result.queryResponses,
      lastSync: new Date().toISOString(),
    };
    setLocalCache(newCache);

    return result.queryResponses;
  } catch (error) {
    console.error('Failed to get session history:', error);

    // Return cached data if available
    const cache = getLocalCache();
    return cache?.queryResponses || [];
  }
}

export async function sessionExists(sessionToken: string): Promise<boolean> {
  try {
    // Check local cache first
    const cache = getLocalCache();
    if (cache && cache.session.sessionToken === sessionToken) {
      return true;
    }

    // Check remote database
    await apiCall(`/api/database/session?sessionToken=${encodeURIComponent(sessionToken)}`);
    return true;
  } catch (error) {
    return false;
  }
}

export async function recoverFromPostgreSQL(sessionToken: string): Promise<boolean> {
  try {
    const result = await apiCall(`/api/database/session?sessionToken=${encodeURIComponent(sessionToken)}`);

    // Update local cache with recovered data
    const newCache: SessionCache = {
      session: result.session,
      queryResponses: result.queryResponses,
      lastSync: new Date().toISOString(),
    };
    setLocalCache(newCache);

    // Update session storage
    sessionStorage.setItem(SESSION_STORAGE_KEY, result.session.sessionToken);
    if (result.session.cookieId) {
      localStorage.setItem(COOKIE_STORAGE_KEY, result.session.cookieId);
    }

    // Initialize token status
    await initializeTokens(result.session.sessionToken, result.session.cookieId);

    return true;
  } catch (error) {
    console.error('Failed to recover from PostgreSQL:', error);
    return false;
  }
}

export async function recoverFromCookieId(cookieId: string): Promise<boolean> {
  try {
    const result = await apiCall(`/api/database/session?cookieId=${encodeURIComponent(cookieId)}`);

    // Update local cache with recovered data
    const newCache: SessionCache = {
      session: result.session,
      queryResponses: result.queryResponses,
      lastSync: new Date().toISOString(),
    };
    setLocalCache(newCache);

    // Update session storage
    sessionStorage.setItem(SESSION_STORAGE_KEY, result.session.sessionToken);
    localStorage.setItem(COOKIE_STORAGE_KEY, result.session.cookieId);

    // Initialize token status
    await initializeTokens(result.session.sessionToken, result.session.cookieId);

    return true;
  } catch (error) {
    console.error('Failed to recover from cookie ID:', error);
    return false;
  }
}

// Initialize database (no-op for client-side)
export async function initializeDatabase(): Promise<void> {
  // Ensure session tokens are set
  const sessionToken = getSessionToken();
  const cookieId = getCookieId();

  // Try to recover session if we have identifiers but no cache
  const cache = getLocalCache();
  if (!cache) {
    try {
      await recoverFromPostgreSQL(sessionToken);
    } catch (error) {
      // Create new session if recovery fails
      await createSession(sessionToken, cookieId);
    }
  } else {
    // Initialize tokens for existing session
    await initializeTokens(sessionToken, cookieId);
  }
}

// Cleanup (no-op for client-side, handled by browser)
export async function cleanupExpiredSessions(): Promise<void> {
  // Browser handles cleanup of localStorage/sessionStorage
  // Server-side cleanup is handled by the API
}

// Shutdown (no-op for client-side)
export async function shutdownDatabase(): Promise<void> {
  // No persistent connections to close on client-side
}