// src/services/agent-service.ts

import type { ModelSettings, LLMProvider, WebSearchResult, StreamingResponse } from "../utils/types";
import { env } from "../env/client.mjs";
import { extractTasks } from "../utils/helpers";
import { WEB_SEARCH_CONFIG, DEFAULT_MODELS, LLM_PROVIDERS } from "../utils/constants";
import { logger, getCurrentTimeContext, getTimeContextPrompt } from "../utils/logger";

export type Analysis = {
  action: "reason" | "search";
  arg: string;
};

export const DefaultAnalysis: Analysis = {
  action: "reason",
  arg: "Fallback due to parsing failure",
};

// Enhanced web search configuration for token optimization
const OPTIMIZED_WEB_SEARCH_CONFIG = {
  MAX_RESULTS: 5,
  SNIPPET_LENGTH: 150,
  TIMEOUT: 8000,
  MAX_TOTAL_CONTENT_LENGTH: 800,
  MIN_SNIPPET_LENGTH: 50,
};

// Enhanced helper to construct absolute URLs with environment detection
function constructApiUrl(endpoint: string, params?: Record<string, string>): string {
  logger.urlConstruction(`Starting URL construction`, {
    endpoint,
    params,
    windowExists: typeof window !== 'undefined'
  });

  try {
    // Handle already absolute URLs
    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
      logger.urlConstruction(`URL already absolute`, { endpoint });
      return endpoint;
    }

    // Clean endpoint
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    logger.urlConstruction(`Cleaned endpoint`, { cleanEndpoint });

    // Add query parameters if provided
    let finalUrl = cleanEndpoint;
    if (params && Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, value);
        }
      });

      if (searchParams.toString()) {
        finalUrl = `${cleanEndpoint}?${searchParams.toString()}`;
      }
    }

    // Environment detection for absolute URL construction
    const isServerSide = typeof window === 'undefined';

    if (isServerSide) {
      // Server-side: need absolute URLs for fetch
      let baseUrl = '';

      // Try multiple environment variable sources for base URL
      if (env.NEXT_PUBLIC_VERCEL_URL) {
        baseUrl = env.NEXT_PUBLIC_VERCEL_URL.startsWith('http')
          ? env.NEXT_PUBLIC_VERCEL_URL
          : `https://${env.NEXT_PUBLIC_VERCEL_URL}`;
      } else if (process.env.VERCEL_URL) {
        baseUrl = `https://${process.env.VERCEL_URL}`;
      } else if (process.env.NEXT_PUBLIC_SITE_URL) {
        baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
      } else if (process.env.SITE_URL) {
        baseUrl = process.env.SITE_URL;
      } else {
        // Development fallback
        baseUrl = 'http://localhost:3000';
      }

      // Ensure baseUrl doesn't end with slash
      baseUrl = baseUrl.replace(/\/$/, '');

      const absoluteUrl = `${baseUrl}${finalUrl}`;

      logger.urlConstruction(`Server-side absolute URL constructed`, {
        baseUrl,
        finalUrl,
        absoluteUrl,
        isServerSide: true
      });

      return absoluteUrl;
    } else {
      // Client-side: relative URLs work fine
      logger.urlConstruction(`Client-side relative URL constructed`, {
        finalUrl,
        isServerSide: false
      });

      return finalUrl;
    }
  } catch (error) {
    logger.error(`URL construction failed`, {
      endpoint,
      params,
      error: error instanceof Error ? error.message : String(error)
    });

    // Enhanced fallback with environment detection
    const isServerSide = typeof window === 'undefined';
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

    if (isServerSide) {
      // Server-side fallback with absolute URL
      const fallbackBase = 'http://localhost:3000';
      const fallbackUrl = `${fallbackBase}${cleanEndpoint}`;

      logger.urlConstruction(`Fallback absolute URL`, {
        fallbackUrl,
        isServerSide: true
      });

      return fallbackUrl;
    } else {
      // Client-side fallback with relative URL
      logger.urlConstruction(`Fallback relative URL`, {
        fallbackUrl: cleanEndpoint,
        isServerSide: false
      });

      return cleanEndpoint;
    }
  }
}

// Token estimation utility
function estimateTokens(text: string): number {
  const tokens = Math.ceil(text.length / 4);
  logger.token(`Estimated tokens`, { textLength: text.length, tokens });
  return tokens;
}

// Enhanced retry utility with logging
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  context: string = 'operation'
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      logger.debug(`Retry attempt ${i + 1}/${maxRetries} for ${context}`);
      const result = await fn();
      if (i > 0) {
        logger.info(`${context} succeeded on retry ${i + 1}`);
      }
      return result;
    } catch (error) {
      lastError = error as Error;
      // ...
    }
  }

  if (lastError) {
    logger.error(`${context} failed after all retries`, {
      error: lastError.message,
      maxRetries
    });
    throw lastError;
  } else {
    throw new Error('Unknown error');
  }
}


// Multi-provider LLM client with enhanced logging
class MultiProviderLLM {
  private modelSettings: ModelSettings;
  private sessionToken?: string;
  private requestId: string;

  constructor(modelSettings: ModelSettings, sessionToken?: string) {
    this.modelSettings = modelSettings;
    this.sessionToken = sessionToken;
    this.requestId = Math.random().toString(36).substring(2, 10);

    logger.llmInteraction(
      modelSettings.llmProvider || 'groq',
      this.getModelName(),
      'initialized',
      {
        requestId: this.requestId,
        sessionToken: sessionToken?.substring(0, 8),
        hasApiKey: !!this.getApiKey()
      }
    );
  }

  private getApiKey(): string {
    const provider = this.modelSettings.llmProvider || "groq";

    let apiKey = '';
    switch (provider) {
      case "groq":
        apiKey = this.modelSettings.groqApiKey ||
          this.modelSettings.customApiKey ||
          env.NEXT_PUBLIC_GROQ_API_KEY || "";
        break;
      case "openrouter":
        apiKey = this.modelSettings.openrouterApiKey ||
          this.modelSettings.customApiKey ||
          env.NEXT_PUBLIC_OPENROUTER_API_KEY || "";
        break;
      case "cohere":
        apiKey = this.modelSettings.cohereApiKey ||
          this.modelSettings.customApiKey ||
          env.NEXT_PUBLIC_COHERE_API_KEY || "";
        break;
      default:
        apiKey = this.modelSettings.customApiKey || "";
    }

    logger.debug(`API key check for ${provider}`, {
      provider,
      hasKey: !!apiKey,
      keyLength: apiKey.length,
      keyPrefix: apiKey.substring(0, 8) + '...',
      requestId: this.requestId
    });

    return apiKey;
  }

  private getModelName(): string {
    const provider = this.modelSettings.llmProvider || "groq";
    const model = this.modelSettings.customModelName || DEFAULT_MODELS[provider];

    logger.debug(`Model selection`, {
      provider,
      selectedModel: model,
      isCustom: !!this.modelSettings.customModelName,
      requestId: this.requestId
    });

    return model;
  }

  private getEndpoint(): string {
    const provider = this.modelSettings.llmProvider || "groq";

    if (this.modelSettings.customEndPoint) {
      logger.debug(`Using custom endpoint`, {
        endpoint: this.modelSettings.customEndPoint,
        provider,
        requestId: this.requestId
      });
      return this.modelSettings.customEndPoint;
    }

    const endpoints = {
      "groq": "https://api.groq.com/openai/v1/chat/completions",
      "openrouter": "https://openrouter.ai/api/v1/chat/completions",
      "cohere": "https://api.cohere.ai/v1/chat"
    };

    const endpoint = endpoints[provider] || endpoints.groq;

    logger.debug(`Selected endpoint for ${provider}`, {
      endpoint,
      provider,
      requestId: this.requestId
    });

    return endpoint;
  }

  private async checkTokensBeforeRequest(prompt: string): Promise<void> {
    if (!this.sessionToken) {
      logger.token(`No session token for token check`, { requestId: this.requestId });
      return;
    }

    try {
      const estimatedTokens = estimateTokens(prompt);
      const url = constructApiUrl('/api/tokens/manage', {
        sessionToken: this.sessionToken
      });

      logger.tokenOperation('pre-request-check', {
        estimatedTokens,
        url,
        sessionToken: this.sessionToken.substring(0, 8),
        requestId: this.requestId
      });

      const response = await retryWithBackoff(
        async () => {
          const res = await fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          });

          if (!res.ok) {
            throw new Error(`Token check failed: ${res.status} ${res.statusText}`);
          }

          return res;
        },
        2,
        1000,
        'token-check'
      );

      logger.apiCall('GET', url, {
        status: response.status,
        ok: response.ok,
        requestId: this.requestId
      });

      const tokenStatus = await response.json();
      logger.tokenOperation('status-retrieved', {
        tokensRemaining: tokenStatus.tokensRemaining,
        canUseTokens: tokenStatus.canUseTokens,
        estimatedNeeded: estimatedTokens,
        requestId: this.requestId
      });

      if (tokenStatus && !tokenStatus.canUseTokens) {
        throw new Error("Demo token limit reached. Please wait for reset or use your own API key.");
      }

      if (tokenStatus && tokenStatus.tokensRemaining < estimatedTokens) {
        throw new Error(`Insufficient demo tokens. Need ${estimatedTokens}, have ${tokenStatus.tokensRemaining}.`);
      }
    } catch (error) {
      logger.error('Token check failed', {
        error: error instanceof Error ? error.message : String(error),
        sessionToken: this.sessionToken.substring(0, 8),
        requestId: this.requestId
      });

      // Allow request to proceed if token check fails, unless it's a token-specific error
      if (error instanceof Error && (
        error.message.includes('token') ||
        error.message.includes('Demo token limit') ||
        error.message.includes('Insufficient demo tokens')
      )) {
        throw error; // Re-throw token-specific errors
      }

      // For other errors (like URL/network issues), log but continue
      logger.warn('Token check failed but continuing with request', {
        error: error instanceof Error ? error.message : String(error),
        requestId: this.requestId
      });
    }
  }

  private async consumeTokensAfterResponse(prompt: string, response: string, metadata: Record<string, any> = {}): Promise<void> {
    if (!this.sessionToken) {
      logger.token(`No session token for consumption`, { requestId: this.requestId });
      return;
    }

    try {
      const estimatedTokens = estimateTokens(prompt + response);
      const url = constructApiUrl('/api/tokens/manage');

      const requestBody = {
        sessionToken: this.sessionToken,
        tokensToConsume: estimatedTokens,
        metadata: {
          ...metadata,
          provider: this.modelSettings.llmProvider,
          model: this.getModelName(),
          promptLength: prompt.length,
          responseLength: response.length,
          timestamp: new Date().toISOString(),
          requestId: this.requestId,
        },
      };

      logger.tokenOperation('consumption-request', {
        tokensToConsume: estimatedTokens,
        url,
        bodySize: JSON.stringify(requestBody).length,
        requestId: this.requestId
      });

      const consumeResponse = await retryWithBackoff(
        async () => {
          const res = await fetch(url, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          });

          if (!res.ok) {
            throw new Error(`Token consumption failed: ${res.status} ${res.statusText}`);
          }

          return res;
        },
        2,
        1000,
        'token-consumption'
      );

      logger.apiCall('PUT', url, {
        status: consumeResponse.status,
        ok: consumeResponse.ok,
        requestId: this.requestId
      });

      const result = await consumeResponse.json();
      logger.tokenOperation('consumption-success', {
        tokensConsumed: estimatedTokens,
        tokensRemaining: result.tokensRemaining,
        requestId: this.requestId
      });
    } catch (error) {
      logger.error('Token consumption error', {
        error: error instanceof Error ? error.message : String(error),
        sessionToken: this.sessionToken.substring(0, 8),
        requestId: this.requestId
      });
    }
  }

  // Streaming support for all providers with enhanced logging
  async callStreaming(prompt: string, variables: Record<string, any> = {}): Promise<string> {
    const startTime = Date.now();

    // Add current time context to prompt
    const timeContext = getTimeContextPrompt();
    let processedPrompt = `${timeContext}\n\n${prompt}`;

    // Replace variables in prompt
    Object.entries(variables).forEach(([key, value]) => {
      const placeholder = `{${key}}`;
      processedPrompt = processedPrompt.replace(new RegExp(placeholder, 'g'), String(value));
    });

    logger.llmInteraction(
      this.modelSettings.llmProvider || 'groq',
      this.getModelName(),
      'streaming-call-start',
      {
        promptLength: processedPrompt.length,
        variables: Object.keys(variables),
        requestId: this.requestId
      }
    );

    await this.checkTokensBeforeRequest(processedPrompt);

    const provider = this.modelSettings.llmProvider || "groq";
    const apiKey = this.getApiKey();

    if (!apiKey || apiKey.trim() === "") {
      const error = `No API key configured for ${provider}. Please add your API key in settings.`;
      logger.error(error, { provider, requestId: this.requestId });
      throw new Error(error);
    }

    try {
      let response: string;

      logger.stream(`Starting ${provider} streaming`, {
        provider,
        model: this.getModelName(),
        promptLength: processedPrompt.length,
        requestId: this.requestId
      });

      switch (provider) {
        case "groq":
          response = await this.streamGroq(processedPrompt);
          break;
        case "openrouter":
          response = await this.streamOpenRouter(processedPrompt);
          break;
        case "cohere":
          response = await this.streamCohere(processedPrompt);
          break;
        default:
          response = await this.streamGroq(processedPrompt);
      }

      const duration = Date.now() - startTime;
      logger.llmInteraction(
        provider,
        this.getModelName(),
        'streaming-call-complete',
        {
          duration,
          responseLength: response.length,
          requestId: this.requestId
        }
      );

      await this.consumeTokensAfterResponse(processedPrompt, response, {
        action: variables.action || 'unknown',
        provider: provider,
        duration
      });

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`LLM Streaming Error (${provider})`, {
        error: error instanceof Error ? error.message : String(error),
        provider,
        model: this.getModelName(),
        duration,
        requestId: this.requestId
      });
      throw error;
    }
  }

  private async streamGroq(prompt: string): Promise<string> {
    const apiKey = this.getApiKey();
    const endpoint = this.getEndpoint();

    logger.stream(`Groq stream request`, {
      endpoint,
      model: this.getModelName(),
      hasApiKey: !!apiKey,
      requestId: this.requestId
    });

    const requestBody = {
      model: this.getModelName(),
      messages: [{ role: "user", content: prompt }],
      temperature: this.modelSettings.customTemperature || 0.9,
      max_tokens: this.modelSettings.customMaxTokens || 400,
      stream: true,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    logger.apiCall('POST', endpoint, {
      status: response.status,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
      requestId: this.requestId
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Groq API error`, {
        status: response.status,
        statusText: response.statusText,
        errorText,
        endpoint,
        requestId: this.requestId
      });
      throw new Error(`Groq API error: ${response.status} - ${errorText}`);
    }

    return this.processOpenAIStream(response, 'groq');
  }

  private async streamOpenRouter(prompt: string): Promise<string> {
    const apiKey = this.getApiKey();
    const endpoint = this.getEndpoint();

    logger.stream(`OpenRouter stream request`, {
      endpoint,
      model: this.getModelName(),
      hasApiKey: !!apiKey,
      requestId: this.requestId
    });

    const requestBody = {
      model: this.getModelName(),
      messages: [{ role: "user", content: prompt }],
      temperature: this.modelSettings.customTemperature || 0.9,
      max_tokens: this.modelSettings.customMaxTokens || 400,
      stream: true,
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.NEXT_PUBLIC_VERCEL_URL || "http://localhost:3000",
        "X-Title": "AutoGPT Next Web",
      },
      body: JSON.stringify(requestBody),
    });

    logger.apiCall('POST', endpoint, {
      status: response.status,
      ok: response.ok,
      requestId: this.requestId
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`OpenRouter API error`, {
        status: response.status,
        statusText: response.statusText,
        errorText,
        endpoint,
        requestId: this.requestId
      });
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    return this.processOpenRouterStream(response, 'openrouter');
  }

  private async streamCohere(prompt: string): Promise<string> {
    const apiKey = this.getApiKey();
    const endpoint = this.getEndpoint();

    logger.stream(`Cohere stream request`, {
      endpoint,
      model: this.getModelName(),
      hasApiKey: !!apiKey,
      requestId: this.requestId
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.getModelName(),
        message: prompt,
        temperature: this.modelSettings.customTemperature || 0.9,
        max_tokens: this.modelSettings.customMaxTokens || 400,
        stream: true,
      }),
    });

    logger.apiCall('POST', endpoint, {
      status: response.status,
      ok: response.ok,
      requestId: this.requestId
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Cohere API error`, {
        status: response.status,
        statusText: response.statusText,
        errorText,
        endpoint,
        requestId: this.requestId
      });
      throw new Error(`Cohere API error: ${response.status} - ${errorText}`);
    }

    return this.processCohereStream(response, 'cohere');
  }

  private async processOpenAIStream(response: Response, provider: string): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullResponse = "";
    let chunkCount = 0;

    logger.stream(`Processing ${provider} stream`, { requestId: this.requestId });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunkCount++;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              logger.stream(`${provider} stream completed`, {
                chunks: chunkCount,
                responseLength: fullResponse.length,
                requestId: this.requestId
              });
              return fullResponse;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullResponse += content;
              }
            } catch (e) {
              // Ignore invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    logger.stream(`${provider} stream ended`, {
      chunks: chunkCount,
      responseLength: fullResponse.length,
      requestId: this.requestId
    });

    return fullResponse;
  }

  private async processOpenRouterStream(response: Response, provider: string): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let fullResponse = "";
    let chunkCount = 0;

    logger.stream(`Processing ${provider} stream`, { requestId: this.requestId });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunkCount++;
        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const lineEnd = buffer.indexOf('\n');
          if (lineEnd === -1) break;

          const line = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);

          if (line.startsWith(':')) {
            continue;
          }

          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              logger.stream(`${provider} stream completed`, {
                chunks: chunkCount,
                responseLength: fullResponse.length,
                requestId: this.requestId
              });
              return fullResponse;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullResponse += content;
              }
            } catch (e) {
              // Ignore invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    logger.stream(`${provider} stream ended`, {
      chunks: chunkCount,
      responseLength: fullResponse.length,
      requestId: this.requestId
    });

    return fullResponse;
  }

  private async processCohereStream(response: Response, provider: string): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullResponse = "";
    let chunkCount = 0;

    logger.stream(`Processing ${provider} stream`, { requestId: this.requestId });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunkCount++;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.event_type === 'text-generation') {
                fullResponse += parsed.text || "";
              } else if (parsed.event_type === 'stream-end') {
                logger.stream(`${provider} stream completed`, {
                  chunks: chunkCount,
                  responseLength: fullResponse.length,
                  requestId: this.requestId
                });
                return fullResponse;
              }
            } catch (e) {
              // Ignore invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    logger.stream(`${provider} stream ended`, {
      chunks: chunkCount,
      responseLength: fullResponse.length,
      requestId: this.requestId
    });

    return fullResponse;
  }

  // Non-streaming fallback
  async call(prompt: string, variables: Record<string, any> = {}): Promise<string> {
    try {
      return await this.callStreaming(prompt, variables);
    } catch (error) {
      logger.warn("Streaming failed, using non-streaming fallback", {
        error: error instanceof Error ? error.message : String(error),
        requestId: this.requestId
      });
      return await this.callNonStreaming(prompt, variables);
    }
  }

  private async callNonStreaming(prompt: string, variables: Record<string, any> = {}): Promise<string> {
    // Add current time context to prompt
    const timeContext = getTimeContextPrompt();
    let processedPrompt = `${timeContext}\n\n${prompt}`;

    Object.entries(variables).forEach(([key, value]) => {
      const placeholder = `{${key}}`;
      processedPrompt = processedPrompt.replace(new RegExp(placeholder, 'g'), String(value));
    });

    await this.checkTokensBeforeRequest(processedPrompt);

    const provider = this.modelSettings.llmProvider || "groq";
    const apiKey = this.getApiKey();

    if (!apiKey) {
      throw new Error(`No API key configured for ${provider}`);
    }

    const messages = [{ role: "user", content: processedPrompt }];
    let response: Response;

    if (provider === "cohere") {
      response = await fetch(this.getEndpoint(), {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.getModelName(),
          message: processedPrompt,
          temperature: this.modelSettings.customTemperature || 0.9,
          max_tokens: this.modelSettings.customMaxTokens || 400,
        }),
      });
    } else {
      response = await fetch(this.getEndpoint(), {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(provider === "openrouter" && {
            "HTTP-Referer": env.NEXT_PUBLIC_VERCEL_URL || "http://localhost:3000",
            "X-Title": "AutoGPT Next Web",
          }),
        },
        body: JSON.stringify({
          model: this.getModelName(),
          messages,
          temperature: this.modelSettings.customTemperature || 0.9,
          max_tokens: this.modelSettings.customMaxTokens || 400,
        }),
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${provider} API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (provider === "cohere") {
      return data.text || "";
    } else {
      return data.choices?.[0]?.message?.content || "";
    }
  }
}

// Enhanced web search functionality with logging
async function performWebSearch(query: string, modelSettings: ModelSettings): Promise<WebSearchResult[]> {
  if (!modelSettings.enableWebSearch) {
    logger.search('Web search disabled', { query });
    return [];
  }

  const searchProvider = modelSettings.webSearchProvider || "google";

  logger.search(`Starting ${searchProvider} search`, {
    query,
    provider: searchProvider
  });

  try {
    if (searchProvider === "google") {
      return await performOptimizedGoogleSearch(query);
    } else if (searchProvider === "serp") {
      return await performOptimizedSerpSearch(query);
    }
    return [];
  } catch (error) {
    logger.error("Web search error", {
      error: error instanceof Error ? error.message : String(error),
      query,
      provider: searchProvider
    });
    return [];
  }
}

async function performOptimizedGoogleSearch(query: string): Promise<WebSearchResult[]> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !engineId) {
    throw new Error("Google Search API credentials not configured");
  }

  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${engineId}&q=${encodeURIComponent(query)}&num=${OPTIMIZED_WEB_SEARCH_CONFIG.MAX_RESULTS}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(OPTIMIZED_WEB_SEARCH_CONFIG.TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`Google Search API error: ${response.statusText}`);
  }

  const data = await response.json();

  const results = (data.items || []).map((item: any) => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet?.substring(0, OPTIMIZED_WEB_SEARCH_CONFIG.SNIPPET_LENGTH) || "",
    source: "google",
  }));

  return optimizeSearchResults(results);
}

async function performOptimizedSerpSearch(query: string): Promise<WebSearchResult[]> {
  const apiKey = process.env.SERP_API_KEY;

  if (!apiKey) {
    throw new Error("SERP API key not configured");
  }

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: OPTIMIZED_WEB_SEARCH_CONFIG.MAX_RESULTS }),
    signal: AbortSignal.timeout(OPTIMIZED_WEB_SEARCH_CONFIG.TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`SERP API error: ${response.statusText}`);
  }

  const data = await response.json();

  const results = (data.organic || []).map((item: any) => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet?.substring(0, OPTIMIZED_WEB_SEARCH_CONFIG.SNIPPET_LENGTH) || "",
    source: "serp",
  }));

  return optimizeSearchResults(results);
}

function optimizeSearchResults(results: WebSearchResult[]): WebSearchResult[] {
  const filteredResults = results.filter(result =>
    result.snippet.length >= OPTIMIZED_WEB_SEARCH_CONFIG.MIN_SNIPPET_LENGTH
  );

  const sortedResults = filteredResults.sort((a, b) => {
    const scoreA = calculateSnippetScore(a.snippet);
    const scoreB = calculateSnippetScore(b.snippet);
    return scoreB - scoreA;
  });

  const optimizedResults: WebSearchResult[] = [];
  let totalContentLength = 0;

  for (const result of sortedResults) {
    const additionalLength = result.title.length + result.snippet.length;

    if (totalContentLength + additionalLength <= OPTIMIZED_WEB_SEARCH_CONFIG.MAX_TOTAL_CONTENT_LENGTH) {
      optimizedResults.push(result);
      totalContentLength += additionalLength;
    } else {
      const remainingLength = OPTIMIZED_WEB_SEARCH_CONFIG.MAX_TOTAL_CONTENT_LENGTH - totalContentLength - result.title.length;

      if (remainingLength >= OPTIMIZED_WEB_SEARCH_CONFIG.MIN_SNIPPET_LENGTH) {
        optimizedResults.push({
          ...result,
          snippet: result.snippet.substring(0, remainingLength - 3) + "..."
        });
        break;
      }
    }
  }

  logger.search(`Search results optimized`, {
    originalCount: results.length,
    optimizedCount: optimizedResults.length,
    totalContentLength
  });

  return optimizedResults.slice(0, 3);
}

function calculateSnippetScore(snippet: string): number {
  let score = snippet.length;

  const numberMatches = snippet.match(/\d+/g);
  if (numberMatches) {
    score += numberMatches.length * 10;
  }

  if (snippet.includes('2024') || snippet.includes('2025')) {
    score += 50;
  }

  const genericPhrases = ['click here', 'read more', 'learn more', 'contact us'];
  for (const phrase of genericPhrases) {
    if (snippet.toLowerCase().includes(phrase)) {
      score -= 20;
    }
  }

  return score;
}

// Agent service implementation with enhanced logging
async function startGoalAgent(
  modelSettings: ModelSettings,
  goal: string,
  customLanguage: string,
  sessionToken?: string
): Promise<string[]> {
  const requestId = Math.random().toString(36).substring(2, 10);

  logger.taskOperation('start-goal', requestId, {
    goal: goal.substring(0, 100),
    language: customLanguage,
    provider: modelSettings.llmProvider,
    sessionToken: sessionToken?.substring(0, 8)
  });

  const llm = new MultiProviderLLM(modelSettings, sessionToken);

  const prompt = `You are AgentGPT, an AI task planning system. Your job is to break down goals into actionable tasks.

GOAL: "${goal}"
LANGUAGE: Answer in "${customLanguage}" language

INSTRUCTIONS:
1. Create 2-4 specific, actionable tasks to achieve this goal
2. Each task should be clear and executable
3. Focus on concrete steps, not abstract concepts
4. Consider if web search might be needed for current information

IMPORTANT: Respond with ONLY a valid JSON array of strings. No explanations, no additional text.
Format: ["Task 1 description", "Task 2 description", "Task 3 description"]

Example response:
["Research current market trends for the goal topic", "Analyze key requirements and constraints", "Create a detailed implementation plan", "Execute the first phase of the plan"]`;

  try {
    const completion = await llm.call(prompt, {
      goal,
      customLanguage,
      action: 'start_goal',
    });

    logger.debug("Goal completion received", {
      goal: goal.substring(0, 50),
      completionLength: completion.length,
      requestId
    });

    const tasks = extractTasks(completion, []);

    if (!Array.isArray(tasks) || tasks.length === 0) {
      logger.warn("No valid tasks extracted, providing fallback", {
        completion: completion.substring(0, 200),
        requestId
      });
      return generateFallbackTasks(goal);
    }

    logger.taskOperation('goal-tasks-created', requestId, {
      taskCount: tasks.length,
      tasks: tasks.map(t => t.substring(0, 50))
    });

    return tasks;
  } catch (error) {
    logger.error("Start goal agent error", {
      error: error instanceof Error ? error.message : String(error),
      goal: goal.substring(0, 50),
      requestId
    });
    return generateFallbackTasks(goal);
  }
}

function generateFallbackTasks(goal: string): string[] {
  const goalLower = goal.toLowerCase();

  logger.debug("Generating fallback tasks", {
    goal: goal.substring(0, 50),
    goalType: goalLower.includes("research") ? "research" :
      goalLower.includes("create") ? "create" :
        goalLower.includes("learn") ? "learn" : "general"
  });

  if (goalLower.includes("research") || goalLower.includes("analyze") || goalLower.includes("study")) {
    return [
      `Research background information about: ${goal}`,
      `Gather relevant data and sources`,
      `Analyze findings and key insights`,
      `Summarize research conclusions`
    ];
  }

  if (goalLower.includes("create") || goalLower.includes("build") || goalLower.includes("develop") || goalLower.includes("make")) {
    return [
      `Plan the requirements for: ${goal}`,
      `Design the structure and approach`,
      `Begin implementation of core components`,
      `Test and refine the solution`
    ];
  }

  if (goalLower.includes("learn") || goalLower.includes("understand") || goalLower.includes("master")) {
    return [
      `Identify key concepts to learn for: ${goal}`,
      `Study fundamental principles and basics`,
      `Practice with examples and exercises`,
      `Apply knowledge to real scenarios`
    ];
  }

  if (goalLower.includes("solve") || goalLower.includes("fix") || goalLower.includes("resolve")) {
    return [
      `Analyze the problem: ${goal}`,
      `Identify potential solutions and approaches`,
      `Test and evaluate different solutions`,
      `Implement the best solution`
    ];
  }

  if (goalLower.includes("plan") || goalLower.includes("organize") || goalLower.includes("strategy")) {
    return [
      `Define scope and objectives for: ${goal}`,
      `Break down into manageable phases`,
      `Identify resources and requirements`,
      `Create detailed timeline and milestones`
    ];
  }

  return [
    `Analyze and understand: ${goal}`,
    `Research relevant information and context`,
    `Develop a detailed action plan`,
    `Execute the plan step by step`
  ];
}

async function analyzeTaskAgent(
  modelSettings: ModelSettings,
  goal: string,
  task: string,
  sessionToken?: string
): Promise<Analysis> {
  const requestId = Math.random().toString(36).substring(2, 10);

  // Log operation
  logger.taskOperation('analyze-task', requestId, {
    task: task.substring(0, 100),
    goal: goal.substring(0, 50),
    provider: modelSettings.llmProvider
  });

  try {
    const llm = new MultiProviderLLM(modelSettings, sessionToken);
    const actions = ["reason", "search"];

    // Construct prompt
    const prompt = `You are analyzing a task to determine the best approach.

GOAL: "${goal}"
CURRENT TASK: "${task}"

INSTRUCTIONS:
1. Determine if this task needs current/recent information that requires web search
2. Use "search" ONLY for tasks about current events, latest news, recent data, or real-time information
3. Use "reason" for analysis, planning, creative tasks, or tasks with existing knowledge

Choose from: ${actions.join(", ")}

Respond with ONLY a JSON object in this exact format:
{"action": "search", "arg": "simple search query"}
OR
{"action": "reason", "arg": "reasoning approach description"}`

    // Call the LLM
    const completion = await llm.call(prompt, {
      goal,
      actions: actions.join(", "),
      task,
      action: 'analyze_task',
    });

    // Log response
    logger.debug("Analysis completion received", {
      completion: completion.substring(0, 200),
      requestId
    });

    // Parse JSON safely
    let analysisResult: Analysis | null = null;
    const match = completion.match(/\{[^}]+\}/); // Extract JSON object

    if (match) {
      let jsonString = match[0];

      // Sanitize the string to fix unquoted string values
      jsonString = sanitizeJsonString(jsonString);

      try {
        analysisResult = JSON.parse(jsonString) as Analysis;
      } catch (parseError) {
        logger.warn("Failed to parse JSON from analysis response", {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          jsonString,
          requestId
        });
      }
    }

    if (analysisResult && analysisResult.action && analysisResult.arg) {
      // Log success
      logger.taskOperation('analysis-complete', requestId, {
        action: analysisResult.action,
        arg: analysisResult.arg.substring(0, 50)
      });
      return analysisResult;
    } else {
      // Fallback if parsing failed or missing fields
      throw new Error("Invalid analysis response");
    }
  } catch (e) {
    // Log error
    logger.error("Error analyzing task", {
      error: e instanceof Error ? e.message : String(e),
      task: task.substring(0, 50),
      requestId
    });

    // Check for keywords to determine fallback
    const taskLower = task.toLowerCase();
    const searchKeywords = ['current', 'latest', 'recent', 'today', 'now', 'update', 'news', 'price', 'stock', 'weather', '2024', '2025'];

    if (searchKeywords.some(keyword => taskLower.includes(keyword))) {
      return {
        action: "search",
        arg: task.substring(0, 50)
      };
    }

    return DefaultAnalysis;
  }
}

// Helper function to sanitize JSON string
function sanitizeJsonString(str: string): string {
  // Replace unquoted "arg" value
  // e.g., "arg":2024 presidential results -> "arg":"2024 presidential results"
  return str.replace(/"arg":\s*([^\s",}][^,}]*)/g, (match, p1) => {
    // If already quoted, do nothing
    if (/^".*"$/.test(p1.trim())) {
      return match;
    }
    const escaped = p1.replace(/"/g, '\\"');
    return `"arg":"${escaped}"`;
  });
}

async function executeTaskAgent(
  modelSettings: ModelSettings,
  goal: string,
  task: string,
  analysis: Analysis,
  customLanguage: string,
  sessionToken?: string
): Promise<string> {
  const requestId = Math.random().toString(36).substring(2, 10);

  logger.taskOperation('execute-task', requestId, {
    task: task.substring(0, 100),
    action: analysis.action,
    useWebSearch: analysis.action === "search" && modelSettings.enableWebSearch
  });

  if (analysis.action === "search" && modelSettings.enableWebSearch) {
    try {
      const searchResults = await performWebSearch(analysis.arg, modelSettings);

      if (searchResults.length > 0) {
        const searchContext = createOptimizedSearchContext(searchResults);

        const llm = new MultiProviderLLM(modelSettings, sessionToken);
        const prompt = `Answer in "${customLanguage}" language.

GOAL: "${goal}"
TASK: "${task}"
SEARCH QUERY: "${analysis.arg}"

CURRENT WEB SEARCH RESULTS:
${searchContext.content}

INSTRUCTIONS:
1. Combine the search results with your existing knowledge
2. Focus on the most recent and relevant information from the search results
3. Provide a comprehensive response that integrates both web findings and your knowledge
4. Be specific and cite key facts from the search results
5. If coding is required, provide code in markdown format

Provide a detailed response that directly addresses the task using both the search results and your knowledge base.`;

        const completion = await llm.call(prompt, {
          goal,
          task,
          customLanguage,
          searchQuery: analysis.arg,
          searchContext: searchContext.content,
          action: 'execute_task_with_search',
        });

        logger.taskOperation('task-executed-with-search', requestId, {
          searchResultCount: searchResults.length,
          responseLength: completion.length
        });

        return `${completion}\n\n**Sources:** ${searchContext.sources}`;
      }
    } catch (error) {
      logger.error("Search execution error", {
        error: error instanceof Error ? error.message : String(error),
        searchQuery: analysis.arg,
        requestId
      });
    }
  }

  try {
    const llm = new MultiProviderLLM(modelSettings, sessionToken);
    const prompt = `Answer in "${customLanguage}" language.

GOAL: "${goal}"
TASK: "${task}"

Complete this task with detailed, actionable information. Be specific and practical in your response. If coding is required, provide code in markdown format.

Provide a comprehensive response that directly addresses the task requirements using your existing knowledge base.`;

    const completion = await llm.call(prompt, {
      goal,
      task,
      customLanguage,
      action: 'execute_task',
    });

    logger.taskOperation('task-executed', requestId, {
      responseLength: completion.length,
      wasSearchDisabled: analysis.action === "search" && !modelSettings.enableWebSearch
    });

    if (analysis.action === "search" && !modelSettings.enableWebSearch) {
      return `\`INFO: Web search is disabled. Using reasoning instead.\`\n\n${completion}`;
    }

    return completion;
  } catch (error) {
    logger.error("Task execution error", {
      error: error instanceof Error ? error.message : String(error),
      task: task.substring(0, 50),
      requestId
    });
    return `Task completed: ${task}\n\nNote: Executed with basic reasoning due to API limitations.`;
  }
}

function createOptimizedSearchContext(searchResults: WebSearchResult[]): { content: string; sources: string } {
  const contextParts: string[] = [];
  const sources: string[] = [];

  searchResults.forEach((result, index) => {
    const entry = `${index + 1}. **${result.title.substring(0, 80)}${result.title.length > 80 ? '...' : ''}**
   ${result.snippet}`;

    contextParts.push(entry);
    sources.push(result.url);
  });

  return {
    content: contextParts.join('\n\n'),
    sources: sources.join(', ')
  };
}

async function createTasksAgent(
  modelSettings: ModelSettings,
  goal: string,
  tasks: string[],
  lastTask: string,
  result: string,
  completedTasks: string[] | undefined,
  customLanguage: string,
  sessionToken?: string
): Promise<string[]> {
  const requestId = Math.random().toString(36).substring(2, 10);

  logger.taskOperation('create-tasks', requestId, {
    lastTask: lastTask.substring(0, 50),
    remainingTasks: tasks.length,
    completedTasks: (completedTasks || []).length
  });

  try {
    const llm = new MultiProviderLLM(modelSettings, sessionToken);

    const totalCompletedTasks = (completedTasks || []).length;
    const remainingTasksCount = tasks.length;
    const progressRatio = totalCompletedTasks / (totalCompletedTasks + remainingTasksCount + 1);

    const prompt = `You are an AI task creation agent. Answer in "${customLanguage}" language.

GOAL: "${goal}"
REMAINING TASKS: ${JSON.stringify(tasks)}
COMPLETED TASKS COUNT: ${totalCompletedTasks}
LAST COMPLETED TASK: "${lastTask}"
TASK RESULT: "${result}"

CONTEXT ANALYSIS:
- Progress: ${Math.round(progressRatio * 100)}% complete
- Remaining tasks: ${remainingTasksCount}
- Last task result quality: ${result.length > 50 ? 'Detailed' : 'Basic'}

DECISION RULES:
1. If progress > 70% and remaining tasks ≤ 2: Return [] (goal likely achievable with existing tasks)
2. If last task result indicates significant progress toward goal: Return [] or maximum 1 task
3. If remaining tasks > 4: Return [] (avoid task overflow)
4. If last task failed or was incomplete: Create 1-2 follow-up tasks
5. If new important aspects discovered: Create 1-2 targeted tasks

CREATE NEW TASKS ONLY IF:
- Essential gaps exist in achieving the goal
- The last task revealed new requirements
- Critical follow-up actions are needed

IMPORTANT: Respond with ONLY a JSON array. Maximum 2 new tasks.
Format: ["New task 1", "New task 2"] or []

If uncertain, prefer [] over creating unnecessary tasks.`;

    const completion = await llm.call(prompt, {
      goal,
      tasks: JSON.stringify(tasks),
      lastTask,
      result,
      customLanguage,
      progressRatio: Math.round(progressRatio * 100),
      action: 'create_tasks',
    });

    logger.debug("Task creation completion", {
      completion: completion.substring(0, 200),
      progressRatio,
      requestId
    });

    const newTasks = extractTasks(completion, completedTasks || []);

    const filteredTasks = intelligentTaskFilter(newTasks, {
      goal,
      completedTasks: completedTasks || [],
      remainingTasks: tasks,
      lastTask,
      result,
      progressRatio
    });

    logger.taskOperation('tasks-created', requestId, {
      extractedTasks: newTasks.length,
      filteredTasks: filteredTasks.length,
      finalTasks: filteredTasks.map(t => t.substring(0, 30))
    });

    return Array.isArray(filteredTasks) ? filteredTasks : [];
  } catch (error) {
    logger.error("Create tasks error", {
      error: error instanceof Error ? error.message : String(error),
      lastTask: lastTask.substring(0, 50),
      requestId
    });
    return [];
  }
}

function intelligentTaskFilter(
  newTasks: string[],
  context: {
    goal: string;
    completedTasks: string[];
    remainingTasks: string[];
    lastTask: string;
    result: string;
    progressRatio: number;
  }
): string[] {
  if (!Array.isArray(newTasks) || newTasks.length === 0) {
    return [];
  }

  const { goal, completedTasks, remainingTasks, progressRatio } = context;

  if (progressRatio > 0.7 && remainingTasks.length <= 2) {
    logger.debug("High progress detected, limiting new tasks");
    return [];
  }

  if (remainingTasks.length > 4) {
    logger.debug("Too many remaining tasks, skipping new task creation");
    return [];
  }

  const allExistingTasks = [...completedTasks, ...remainingTasks];
  const filteredTasks = newTasks.filter(newTask => {
    const newTaskLower = newTask.toLowerCase();
    return !allExistingTasks.some(existingTask => {
      const existingLower = existingTask.toLowerCase();
      const words1 = newTaskLower.split(' ').filter(w => w.length > 3);
      const words2 = existingLower.split(' ').filter(w => w.length > 3);
      const overlap = words1.filter(w => words2.includes(w)).length;
      return overlap > Math.min(words1.length, words2.length) * 0.6;
    });
  });

  const limitedTasks = filteredTasks.slice(0, 2);

  const goalLower = goal.toLowerCase();
  if (goalLower.includes('what is') || goalLower.includes('explain') || goalLower.includes('define')) {
    if (completedTasks.length >= 2) {
      logger.debug("Information goal likely satisfied, limiting new tasks");
      return [];
    }
  }

  logger.debug(`Task filtering result`, {
    input: newTasks.length,
    output: limitedTasks.length
  });

  return limitedTasks;
}

interface AgentService {
  startGoalAgent: (
    modelSettings: ModelSettings,
    goal: string,
    customLanguage: string,
    sessionToken?: string
  ) => Promise<string[]>;
  analyzeTaskAgent: (
    modelSettings: ModelSettings,
    goal: string,
    task: string,
    sessionToken?: string
  ) => Promise<Analysis>;
  executeTaskAgent: (
    modelSettings: ModelSettings,
    goal: string,
    task: string,
    analysis: Analysis,
    customLanguage: string,
    sessionToken?: string
  ) => Promise<string>;
  createTasksAgent: (
    modelSettings: ModelSettings,
    goal: string,
    tasks: string[],
    lastTask: string,
    result: string,
    completedTasks: string[] | undefined,
    customLanguage: string,
    sessionToken?: string
  ) => Promise<string[]>;
}

const RealAgentService: AgentService = {
  startGoalAgent,
  analyzeTaskAgent,
  executeTaskAgent,
  createTasksAgent,
};

const MockAgentService: AgentService = {
  startGoalAgent: async (modelSettings, goal, customLanguage, sessionToken) => {
    logger.info("Mock service: start goal agent", { goal: goal.substring(0, 50) });
    return ["Analyze the goal requirements", "Research relevant information", "Create an action plan", "Execute the plan"];
  },

  createTasksAgent: async (
    modelSettings: ModelSettings,
    goal: string,
    tasks: string[],
    lastTask: string,
    result: string,
    completedTasks: string[] | undefined,
    customLanguage: string,
    sessionToken?: string
  ) => {
    logger.info("Mock service: create tasks agent", {
      completedCount: (completedTasks || []).length
    });
    if ((completedTasks || []).length >= 3) return [];
    return ["Continue working towards goal"];
  },

  analyzeTaskAgent: async (
    modelSettings: ModelSettings,
    goal: string,
    task: string,
    sessionToken?: string
  ) => {
    logger.info("Mock service: analyze task agent", { task: task.substring(0, 50) });
    return {
      action: "reason",
      arg: "Mock analysis approach",
    };
  },

  executeTaskAgent: async (
    modelSettings: ModelSettings,
    goal: string,
    task: string,
    analysis: Analysis,
    customLanguage: string,
    sessionToken?: string
  ) => {
    logger.info("Mock service: execute task agent", { task: task.substring(0, 50) });
    return "Mock result for task: " + task;
  },
};

export default env.NEXT_PUBLIC_FF_MOCK_MODE_ENABLED
  ? MockAgentService
  : RealAgentService;