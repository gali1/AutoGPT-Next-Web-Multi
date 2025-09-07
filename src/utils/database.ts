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

// Fixed URL construction that works reliably in all environments
function constructApiUrl(endpoint: string): string {
  // Handle already absolute URLs
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }

  // Clean endpoint
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  // In browser environment, always use relative URLs to avoid CORS issues
  if (typeof window !== 'undefined') {
    return cleanEndpoint;
  }

  // In server environment, try to construct absolute URL
  try {
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_VERCEL_URL
      ? process.env.NEXT_PUBLIC_VERCEL_URL
      : 'http://localhost:3000';

    return `${baseUrl}${cleanEndpoint}`;
  } catch (error) {
    console.warn('Error constructing absolute URL, using relative:', error);
    return cleanEndpoint;
  }
}

// Session management
export function getSessionToken(): string {
  if (typeof window === 'undefined') return '';

  try {
    let sessionToken = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!sessionToken) {
      sessionToken = uuidv4();
      sessionStorage.setItem(SESSION_STORAGE_KEY, sessionToken);
    }
    return sessionToken;
  } catch (error) {
    console.warn('Session storage not available:', error);
    return uuidv4(); // Return a temporary token
  }
}

export function getCookieId(): string {
  if (typeof window === 'undefined') return '';

  try {
    let cookieId = localStorage.getItem(COOKIE_STORAGE_KEY);
    if (!cookieId) {
      cookieId = uuidv4();
      localStorage.setItem(COOKIE_STORAGE_KEY, cookieId);
    }
    return cookieId;
  } catch (error) {
    console.warn('Local storage not available:', error);
    return uuidv4(); // Return a temporary ID
  }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;

  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(COOKIE_STORAGE_KEY);
    localStorage.removeItem(LOCAL_CACHE_KEY);
  } catch (error) {
    console.warn('Error clearing session:', error);
  }
}

// Local cache management with better error handling
function getLocalCache(): SessionCache | null {
  if (typeof window === 'undefined') return null;

  try {
    const cached = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!cached) return null;

    const parsed = JSON.parse(cached);

    // Validate cache structure
    if (!parsed || !parsed.session || !Array.isArray(parsed.queryResponses)) {
      console.warn('Invalid cache structure, clearing');
      localStorage.removeItem(LOCAL_CACHE_KEY);
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn('Failed to parse local cache, clearing:', error);
    try {
      localStorage.removeItem(LOCAL_CACHE_KEY);
    } catch (clearError) {
      console.warn('Failed to clear corrupted cache:', clearError);
    }
    return null;
  }
}

function setLocalCache(cache: SessionCache): void {
  if (typeof window === 'undefined') return;

  try {
    // Validate cache before saving
    if (!cache || !cache.session || !Array.isArray(cache.queryResponses)) {
      console.warn('Invalid cache structure, not saving');
      return;
    }

    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('Failed to save local cache:', error);
    // Try to clear space and retry once
    try {
      localStorage.removeItem(LOCAL_CACHE_KEY);
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cache));
    } catch (retryError) {
      console.error('Failed to save cache even after clearing:', retryError);
    }
  }
}

// Enhanced API call utilities with better error handling and timeout
async function apiCall(endpoint: string, options: RequestInit = {}): Promise<any> {
  const url = constructApiUrl(endpoint);

  // Add timeout to prevent hanging requests
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      signal: controller.signal,
      ...options,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorText = '';
      try {
        errorText = await response.text();
      } catch (textError) {
        errorText = 'Failed to read error response';
      }

      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    } else {
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch (parseError) {
        console.warn('Response is not JSON, returning as text');
        return { data: text };
      }
    }
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle different types of errors
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        console.warn(`API call to ${url} timed out`);
        throw new Error('Request timed out');
      }

      console.warn(`API call to ${url} failed:`, error.message);

      // For token-related API calls, fail more gracefully
      if (url.includes('/api/tokens/')) {
        console.warn('Token API call failed, returning null to continue operation');
        return null;
      }
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
      return getDefaultTokenStatus();
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
          timestamp: new Date().toISOString(),
        },
      }),
    });

    if (!result) {
      return getDefaultTokenStatus();
    }

    // Ensure proper token status structure with validation
    const tokenStatus = {
      tokensUsed: typeof result.tokensUsed === 'number' ? result.tokensUsed : 0,
      tokensRemaining: typeof result.tokensRemaining === 'number' ? result.tokensRemaining : 10000,
      resetAt: result.resetAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      timeUntilReset: typeof result.timeUntilReset === 'number' ? result.timeUntilReset : 24 * 60 * 60 * 1000,
      canUseTokens: Boolean(result.tokensRemaining > 0),
    };

    // Update local cache safely
    try {
      const cache = getLocalCache();
      if (cache) {
        cache.tokenStatus = tokenStatus;
        cache.lastSync = new Date().toISOString();
        setLocalCache(cache);
      }
    } catch (cacheError) {
      console.warn('Failed to update cache with token status:', cacheError);
    }

    return tokenStatus;
  } catch (error) {
    console.warn('Failed to initialize tokens:', error);
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

    // Validate and normalize result
    const tokenStatus = {
      tokensUsed: typeof result.tokensUsed === 'number' ? result.tokensUsed : 0,
      tokensRemaining: typeof result.tokensRemaining === 'number' ? result.tokensRemaining : 10000,
      resetAt: result.resetAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      timeUntilReset: typeof result.timeUntilReset === 'number' ? result.timeUntilReset : 24 * 60 * 60 * 1000,
      canUseTokens: Boolean(result.tokensRemaining > 0),
    };

    // Update local cache safely
    try {
      if (cache) {
        cache.tokenStatus = tokenStatus;
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
          tokenStatus: tokenStatus,
          lastSync: new Date().toISOString(),
        };
        setLocalCache(newCache);
      }
    } catch (cacheError) {
      console.warn('Failed to update cache:', cacheError);
    }

    return tokenStatus;
  } catch (error) {
    console.warn('Failed to get token status:', error);

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

    if (typeof tokensToConsume !== 'number' || tokensToConsume < 0) {
      console.warn('Invalid token consumption amount:', tokensToConsume);
      return {
        success: false,
        tokensRemaining: 0,
        error: 'Invalid token amount',
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

    // Update local cache safely
    try {
      const cache = getLocalCache();
      if (cache) {
        cache.tokenStatus = {
          tokensUsed: typeof result.tokensUsed === 'number' ? result.tokensUsed : 0,
          tokensRemaining: typeof result.tokensRemaining === 'number' ? result.tokensRemaining : 0,
          resetAt: result.resetAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          timeUntilReset: new Date(result.resetAt).getTime() - Date.now(),
          canUseTokens: Boolean(result.tokensRemaining > 0),
        };
        cache.lastSync = new Date().toISOString();
        setLocalCache(cache);
      }
    } catch (cacheError) {
      console.warn('Failed to update cache after token consumption:', cacheError);
    }

    return {
      success: true,
      tokensRemaining: typeof result.tokensRemaining === 'number' ? result.tokensRemaining : 0,
    };
  } catch (error) {
    console.warn('Failed to consume tokens:', error);

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
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString(),
        },
      }),
    });

    if (!result) {
      console.warn('Session creation failed, but continuing');
      return false;
    }

    // Initialize tokens for new session
    try {
      await initializeTokens(token, cookie);
    } catch (tokenError) {
      console.warn('Failed to initialize tokens after session creation:', tokenError);
    }

    // Update local storage safely
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(SESSION_STORAGE_KEY, token);
        localStorage.setItem(COOKIE_STORAGE_KEY, cookie);
      }
    } catch (storageError) {
      console.warn('Failed to update local storage:', storageError);
    }

    return Boolean(result.success);
  } catch (error) {
    console.warn('Failed to create session:', error);
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
    if (!sessionToken || !query || !response) {
      console.warn('Missing required parameters for query response save');
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

    // Update cache safely
    try {
      if (cache) {
        cache.queryResponses.push(queryResponse);
        cache.lastSync = new Date().toISOString();
        setLocalCache(cache);
      }
    } catch (cacheError) {
      console.warn('Failed to update local cache:', cacheError);
    }

    // Save to remote database
    try {
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

      return Boolean(result?.success);
    } catch (apiError) {
      console.warn('Failed to save to remote database:', apiError);
      return true; // Still return true if local cache was updated
    }
  } catch (error) {
    console.error('Failed to save query response:', error);
    return false;
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
      return cache.queryResponses || [];
    }

    // Fetch from remote database
    const result = await apiCall(`/api/database/session?sessionToken=${encodeURIComponent(sessionToken)}`);

    if (!result) {
      // Return cached data if available
      return cache?.queryResponses || [];
    }

    // Validate result structure
    const queryResponses = Array.isArray(result.queryResponses) ? result.queryResponses : [];

    // Update local cache safely
    try {
      const newCache: SessionCache = {
        session: result.session || {
          sessionToken,
          createdAt: new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
        },
        queryResponses,
        lastSync: new Date().toISOString(),
      };
      setLocalCache(newCache);
    } catch (cacheError) {
      console.warn('Failed to update cache with session history:', cacheError);
    }

    return queryResponses;
  } catch (error) {
    console.warn('Failed to get session history:', error);

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
    return Boolean(result);
  } catch (error) {
    console.warn('Failed to check session existence:', error);
    return false;
  }
}

export async function recoverFromPostgreSQL(sessionToken: string): Promise<boolean> {
  try {
    if (!sessionToken) {
      return false;
    }

    const result = await apiCall(`/api/database/session?sessionToken=${encodeURIComponent(sessionToken)}`);

    if (!result || !result.session) {
      return false;
    }

    // Update local cache with recovered data
    try {
      const newCache: SessionCache = {
        session: result.session,
        queryResponses: Array.isArray(result.queryResponses) ? result.queryResponses : [],
        lastSync: new Date().toISOString(),
      };
      setLocalCache(newCache);
    } catch (cacheError) {
      console.warn('Failed to update cache with recovered data:', cacheError);
    }

    // Update session storage safely
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(SESSION_STORAGE_KEY, result.session.sessionToken);
        if (result.session.cookieId) {
          localStorage.setItem(COOKIE_STORAGE_KEY, result.session.cookieId);
        }
      }
    } catch (storageError) {
      console.warn('Failed to update storage after recovery:', storageError);
    }

    // Initialize token status
    try {
      await initializeTokens(result.session.sessionToken, result.session.cookieId);
    } catch (tokenError) {
      console.warn('Failed to initialize tokens after recovery:', tokenError);
    }

    return true;
  } catch (error) {
    console.warn('Failed to recover from PostgreSQL:', error);
    return false;
  }
}

export async function recoverFromCookieId(cookieId: string): Promise<boolean> {
  try {
    if (!cookieId) {
      return false;
    }

    const result = await apiCall(`/api/database/session?cookieId=${encodeURIComponent(cookieId)}`);

    if (!result || !result.session) {
      return false;
    }

    // Update local cache with recovered data
    try {
      const newCache: SessionCache = {
        session: result.session,
        queryResponses: Array.isArray(result.queryResponses) ? result.queryResponses : [],
        lastSync: new Date().toISOString(),
      };
      setLocalCache(newCache);
    } catch (cacheError) {
      console.warn('Failed to update cache with recovered data:', cacheError);
    }

    // Update session storage safely
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(SESSION_STORAGE_KEY, result.session.sessionToken);
        localStorage.setItem(COOKIE_STORAGE_KEY, result.session.cookieId);
      }
    } catch (storageError) {
      console.warn('Failed to update storage after recovery:', storageError);
    }

    // Initialize token status
    try {
      await initializeTokens(result.session.sessionToken, result.session.cookieId);
    } catch (tokenError) {
      console.warn('Failed to initialize tokens after recovery:', tokenError);
    }

    return true;
  } catch (error) {
    console.warn('Failed to recover from cookie ID:', error);
    return false;
  }
}

// Initialize database (improved error handling)
export async function initializeDatabase(): Promise<void> {
  // Only run in browser environment
  if (typeof window === 'undefined') return;

  try {
    // Ensure session tokens are set
    const sessionToken = getSessionToken();
    const cookieId = getCookieId();

    if (!sessionToken) {
      console.warn('Failed to initialize session token');
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
        console.warn('Database initialization failed, creating new session:', error);
        // Create new session as fallback
        await createSession(sessionToken, cookieId);
      }
    } else {
      // Initialize tokens for existing session
      try {
        await initializeTokens(sessionToken, cookieId);
      } catch (error) {
        console.warn('Failed to initialize tokens for existing session:', error);
      }
    }
  } catch (error) {
    console.error('Database initialization failed:', error);
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