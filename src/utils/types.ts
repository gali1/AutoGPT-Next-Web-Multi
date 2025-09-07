// src/utils/types.ts

export type LLMProvider = "groq" | "openrouter" | "cohere";

export type ModelSettings = {
  customApiKey?: string;
  customModelName?: string;
  customTemperature?: number;
  customMaxLoops?: number;
  customEndPoint?: string;
  customMaxTokens?: number;
  customGuestKey?: string;
  llmProvider?: LLMProvider;
  groqApiKey?: string;
  openrouterApiKey?: string;
  cohereApiKey?: string;
  enableWebSearch?: boolean;
  webSearchProvider?: "google"; // Removed "serp" option
};

export type GuestSettings = {
  isValidGuest: boolean;
  isGuestMode: boolean;
};

export type SettingModel = {
  settings: ModelSettings;
  saveSettings: (settings: ModelSettings) => void;
  resetSettings: () => void;
};

export type StreamingResponse = {
  content: string;
  finished: boolean;
  error?: string;
  metadata?: Record<string, any>;
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
};

export type DatabaseSession = {
  sessionToken: string;
  cookieId: string | null;
  createdAt: string;
  lastAccessed: string;
  metadata: Record<string, any>;
};

export type QueryResponse = {
  id: string;
  sessionToken: string;
  query: string;
  response: string;
  createdAt: string;
  metadata: Record<string, any>;
  isSynced: boolean;
};