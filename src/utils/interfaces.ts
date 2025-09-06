// src/utils/interfaces.ts

import type { ModelSettings } from "./types";
import type { Analysis } from "../services/agent-service";

export interface RequestBody {
  modelSettings: ModelSettings;
  goal: string;
  customLanguage: string;
  task?: string;
  tasks?: string[];
  lastTask?: string;
  result?: string;
  completedTasks?: string[];
  analysis?: Analysis;
  sessionToken?: string;
}

export interface StreamingResponse {
  type: "status" | "content" | "error" | "complete";
  message?: string;
  content?: string;
  error?: string;
  result?: any;
  timestamp: string;
  requestId?: string;
  metadata?: Record<string, any>;
}

export interface DatabaseSaveRequest {
  sessionToken: string;
  query: string;
  response: string;
  metadata?: {
    type?: string;
    llmProvider?: string;
    processingTime?: number;
    taskId?: string;
    parentTaskId?: string;
    requestId?: string;
    [key: string]: any;
  };
}

export interface SessionInfo {
  sessionToken: string;
  cookieId?: string;
  createdAt: string;
  lastAccessed: string;
  metadata?: Record<string, any>;
}

export interface WebSearchRequest {
  query: string;
  provider: "google" | "serp";
  maxResults?: number;
  language?: string;
}

export interface LLMRequest {
  provider: "groq" | "openrouter" | "cohere";
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  supportedModels: string[];
  maxTokensLimit: number;
  supportsStreaming: boolean;
}