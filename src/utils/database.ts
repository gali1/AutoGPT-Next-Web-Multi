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

// Helper to get the base URL for API calls - more robust version
function getBaseUrl(): string {
  // In browser environment, always use relative URLs to avoid CORS issues
  if (typeof window !== 'undefined') {
    return '';
  }

  // Server environment - construct absolute URL
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  if (process.env.NEXT_PUBLIC_VERCEL_URL) {
    return process.env.NEXT_PUBLIC_VERCEL_URL;
  }

  return `http://localhost:${process.env.PORT ?? 3000}`;
}

// Robust URL construction that works in all environments
function constructApiUrl(endpoint: string): string {
  // Handle absolute URLs
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }

  // Ensure endpoint starts with /
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  // In browser, use relative URLs
  if (typeof window !== 'undefined') {
    return cleanEndpoint;
  }

  // In server, use absolute URLs
  const baseUrl = getBaseUrl();
  return `${baseUrl}${cleanEndpoint}`;
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

// Enhanced API call utilities with better error handling
async function apiCall(endpoint: string, options: RequestInit = {}): Promise<any> {
  const url = constructApiUrl(endpoint);

  try {
    console.log(`Making API call to: ${url}`);

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API call failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response.json();
  } catch (error) {
    console.error(`API call to ${url} failed:`, error);

    // For token-related API calls, fail silently to not break the main flow
    if (url.includes('/api/tokens/')) {
      console.warn('Token API call failed, continuing without token tracking');
      return null;
    }

    throw error;
  }
}

// Token management with enhanced error handling
export async function initializeTokens(sessionToken?: string, cookieId?: string): Promise<TokenStatus | null> {
  try {
    const token = sessionToken || getSessionToken();
    const cookie = cookieId || getCookieId();

    if (!token) {
      console.warn('No session token available for token initialization');
      return null;
    }

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

    if (!result) {
      return getDefaultTokenStatus();
    }

    // Ensure proper token status structure
    const tokenStatus = {
      tokensUsed: result.tokensUsed || 0,
      tokensRemaining: result.tokensRemaining || 10000,
      resetAt: result.resetAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      timeUntilReset: result.timeUntilReset || 24 * 60 * 60 * 1000,
      canUseTokens: (result.tokensRemaining || 10000) > 0,
    };

    // Update local cache
    const cache = getLocalCache();
    if (cache) {
      cache.tokenStatus = tokenStatus;
      cache.lastSync = new Date().toISOString();
      setLocalCache(cache);
    }

    return tokenStatus;
  } catch (error) {
    console.error('Failed to initialize tokens:', error);
    return getDefaultTokenStatus();
  }
}

function getDefaultTokenStatus(): TokenStatus {
  return {
    tokensUsed: 0,
    tokensRemaining: 10000,
    resetAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    timeUntilReset: 24 * 60 * 60 * 1000,
    canUseTokens: true,
  };
}

export async function getTokenStatus(sessionToken?: string): Promise<TokenStatus | null> {
  try {
    const token = sessionToken || getSessionToken();

    if (!token) {
      console.warn('No session token available for token status check');
      return getDefaultTokenStatus();
    }

    // Check local cache first
    const cache = getLocalCache();
    if (cache?.tokenStatus && cache.session?.sessionToken === token) {
      // Check if cache is recent (less than 30 seconds old)
      const cacheAge = Date.now() - new Date(cache.lastSync).getTime();
      if (cacheAge < 30000) {
        return cache.tokenStatus;
      }
    }

    const result = await apiCall(`/api/tokens/manage?sessionToken=${encodeURIComponent(token)}`);

    if (!result) {
      // Return cached data if available, otherwise default
      return cache?.tokenStatus || getDefaultTokenStatus();
    }

    // Update local cache
    if (cache) {
      cache.tokenStatus = result;
      cache.lastSync = new Date().toISOString();
      setLocalCache(cache);
    } else {
      // Create new cache entry
      const newCache: SessionCache = {
        session: {
          sessionToken: token,
          createdAt: new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
        },
        queryResponses: [],
        tokenStatus: result,
        lastSync: new Date().toISOString(),
      };
      setLocalCache(newCache);
    }

    return result;
  } catch (error) {
    console.error('Failed to get token status:', error);

    // Return cached data if available
    const cache = getLocalCache();
    return cache?.tokenStatus || getDefaultTokenStatus();
  }
}

export async function consumeTokens(
  tokensToConsume: number,
  sessionToken?: string,
  metadata: Record<string, any> = {}
): Promise<{ success: boolean; tokensRemaining: number; error?: string }> {
  try {
    const token = sessionToken || getSessionToken();

    if (!token) {
      console.warn('No session token available for token consumption');
      return {
        success: false,
        tokensRemaining: 0,
        error: 'No session token',
      };
    }

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

    if (!result) {
      return {
        success: false,
        tokensRemaining: 0,
        error: 'Token API unavailable',
      };
    }

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
    if (error instanceof Error && (error.message.includes('403') || error.message.includes('Insufficient'))) {
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

// Database operations with better error handling
export async function createSession(sessionToken?: string, cookieId?: string, metadata: Record<string, any> = {}): Promise<boolean> {
  try {
    const token = sessionToken || getSessionToken();
    const cookie = cookieId || getCookieId();

    if (!token) {
      console.warn('No session token available for session creation');
      return false;
    }

    const result = await apiCall('/api/database/session', {
      method: 'POST',
      body: JSON.stringify({
        sessionToken: token,
        cookieId: cookie,
        metadata,
      }),
    });

    if (!result) {
      console.warn('Session creation failed, but continuing');
      return false;
    }

    // Initialize tokens for new session
    await initializeTokens(token, cookie);

    // Update local storage
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SESSION_STORAGE_KEY, token);
      localStorage.setItem(COOKIE_STORAGE_KEY, cookie);
    }

    return result.success || false;
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
    if (!sessionToken) {
      console.warn('No session token provided for query response save');
      return false;
    }

    // Estimate token consumption (rough approximation)
    const estimatedTokens = Math.ceil((query.length + response.length) / 4);

    // Check if user has enough tokens before saving
    const tokenStatus = await getTokenStatus(sessionToken);
    if (tokenStatus && !tokenStatus.canUseTokens) {
      console.warn('No tokens remaining, skipping save');
      return false;
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

    return result?.success || true; // Return true if local cache was updated
  } catch (error) {
    console.error('Failed to save query response:', error);
    return true; // Still return true if local cache was updated
  }
}

export async function getSessionHistory(sessionToken: string): Promise<QueryResponseData[]> {
  try {
    if (!sessionToken) {
      console.warn('No session token provided for history retrieval');
      return [];
    }

    // Try local cache first
    const cache = getLocalCache();
    if (cache && cache.session.sessionToken === sessionToken) {
      return cache.queryResponses;
    }

    // Fetch from remote database
    const result = await apiCall(`/api/database/session?sessionToken=${encodeURIComponent(sessionToken)}`);

    if (!result) {
      // Return cached data if available
      return cache?.queryResponses || [];
    }

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
    if (!sessionToken) {
      return false;
    }

    // Check local cache first
    const cache = getLocalCache();
    if (cache && cache.session.sessionToken === sessionToken) {
      return true;
    }

    // Check remote database
    const result = await apiCall(`/api/database/session?sessionToken=${encodeURIComponent(sessionToken)}`);
    return !!result;
  } catch (error) {
    console.error('Failed to check session existence:', error);
    return false;
  }
}

export async function recoverFromPostgreSQL(sessionToken: string): Promise<boolean> {
  try {
    if (!sessionToken) {
      return false;
    }

    const result = await apiCall(`/api/database/session?sessionToken=${encodeURIComponent(sessionToken)}`);

    if (!result) {
      return false;
    }

    // Update local cache with recovered data
    const newCache: SessionCache = {
      session: result.session,
      queryResponses: result.queryResponses,
      lastSync: new Date().toISOString(),
    };
    setLocalCache(newCache);

    // Update session storage
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SESSION_STORAGE_KEY, result.session.sessionToken);
      if (result.session.cookieId) {
        localStorage.setItem(COOKIE_STORAGE_KEY, result.session.cookieId);
      }
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
    if (!cookieId) {
      return false;
    }

    const result = await apiCall(`/api/database/session?cookieId=${encodeURIComponent(cookieId)}`);

    if (!result) {
      return false;
    }

    // Update local cache with recovered data
    const newCache: SessionCache = {
      session: result.session,
      queryResponses: result.queryResponses,
      lastSync: new Date().toISOString(),
    };
    setLocalCache(newCache);

    // Update session storage
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SESSION_STORAGE_KEY, result.session.sessionToken);
      localStorage.setItem(COOKIE_STORAGE_KEY, result.session.cookieId);
    }

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
  // Only run in browser environment
  if (typeof window === 'undefined') return;

  // Ensure session tokens are set
  const sessionToken = getSessionToken();
  const cookieId = getCookieId();

  if (!sessionToken || !cookieId) {
    console.warn('Failed to initialize session tokens');
    return;
  }

  // Try to recover session if we have identifiers but no cache
  const cache = getLocalCache();
  if (!cache) {
    try {
      const recovered = await recoverFromPostgreSQL(sessionToken);
      if (!recovered) {
        // Create new session if recovery fails
        await createSession(sessionToken, cookieId);
      }
    } catch (error) {
      console.error('Database initialization failed:', error);
      // Create new session as fallback
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