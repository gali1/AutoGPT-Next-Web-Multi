// src/hooks/useSettings.ts

import { useState, useCallback } from "react";
import type { ModelSettings, LLMProvider } from "../utils/types";
import {
  DEFAULT_MAX_LOOPS_CUSTOM_API_KEY,
  DEFAULT_MAX_LOOPS_FREE,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  LLM_PROVIDERS,
  DEFAULT_MODELS,
} from "../utils/constants";
import { isGuestMode } from "../utils/env-helper";

const SETTINGS_KEY = "AUTOGPT_SETTINGS";

export const DEFAULT_SETTINGS: ModelSettings = {
  customApiKey: "",
  customModelName: "",
  customTemperature: DEFAULT_TEMPERATURE,
  customMaxLoops: DEFAULT_MAX_LOOPS_FREE,
  customMaxTokens: DEFAULT_MAX_TOKENS,
  customEndPoint: "",
  customGuestKey: "",
  llmProvider: LLM_PROVIDERS.GROQ,
  groqApiKey: "",
  openrouterApiKey: "",
  cohereApiKey: "",
  enableWebSearch: false,
  webSearchProvider: "google" as const, // Only Google supported
};

const loadSettings = (): ModelSettings => {
  const defaultSettings = { ...DEFAULT_SETTINGS };

  if (typeof window === "undefined") {
    return defaultSettings;
  }

  const data = localStorage.getItem(SETTINGS_KEY);
  if (!data) {
    return defaultSettings;
  }

  try {
    const obj = JSON.parse(data) as ModelSettings;
    Object.entries(obj).forEach(([key, value]) => {
      if (key in defaultSettings) {
        (defaultSettings as any)[key] = value;
      }
    });
  } catch (error) {
    console.error("Error loading settings:", error);
  }

  // Ensure provider is valid
  if (!defaultSettings.llmProvider || !Object.values(LLM_PROVIDERS).includes(defaultSettings.llmProvider)) {
    defaultSettings.llmProvider = LLM_PROVIDERS.GROQ;
  }

  // Set default model for provider if not set
  const currentProvider = defaultSettings.llmProvider;
  const currentModel = defaultSettings.customModelName;

  // If no model or empty model, set default for provider
  if (!currentModel || currentModel.trim() === "") {
    defaultSettings.customModelName = DEFAULT_MODELS[currentProvider];
  }

  // Ensure webSearchProvider is always "google"
  if (defaultSettings.webSearchProvider !== "google") {
    defaultSettings.webSearchProvider = "google" as const;
  }

  // Reset to defaults if no API key and not guest mode
  if (!isGuestMode() && !hasValidApiKey(defaultSettings)) {
    const resetSettings = { ...DEFAULT_SETTINGS };
    resetSettings.customGuestKey = defaultSettings.customGuestKey; // Preserve guest key
    return resetSettings;
  }

  // Upgrade max loops if using custom API key
  if (hasValidApiKey(defaultSettings) && defaultSettings.customMaxLoops === DEFAULT_MAX_LOOPS_FREE) {
    defaultSettings.customMaxLoops = DEFAULT_MAX_LOOPS_CUSTOM_API_KEY;
  }

  return { ...defaultSettings };
};

const hasValidApiKey = (settings: ModelSettings): boolean => {
  const provider = settings.llmProvider || LLM_PROVIDERS.GROQ;

  switch (provider) {
    case LLM_PROVIDERS.GROQ:
      return !!(settings.groqApiKey || settings.customApiKey);
    case LLM_PROVIDERS.OPENROUTER:
      return !!(settings.openrouterApiKey || settings.customApiKey);
    case LLM_PROVIDERS.COHERE:
      return !!(settings.cohereApiKey || settings.customApiKey);
    default:
      return !!settings.customApiKey;
  }
};

export function useSettings() {
  const [settings, setSettings] = useState<ModelSettings>(() => loadSettings());

  const saveSettings = useCallback((newSettings: ModelSettings) => {
    console.log("Saving settings:", newSettings);

    let processedSettings = { ...newSettings };

    // Ensure provider is valid
    if (!processedSettings.llmProvider || !Object.values(LLM_PROVIDERS).includes(processedSettings.llmProvider)) {
      processedSettings.llmProvider = LLM_PROVIDERS.GROQ;
    }

    // If no model specified, set default for provider
    if (!processedSettings.customModelName || processedSettings.customModelName.trim() === "") {
      processedSettings.customModelName = DEFAULT_MODELS[processedSettings.llmProvider];
    }

    // Ensure webSearchProvider is always "google"
    processedSettings.webSearchProvider = "google" as const;

    // Reset to defaults if no API key and not guest mode (preserve certain settings)
    if (!hasValidApiKey(processedSettings) && !isGuestMode()) {
      const { customGuestKey, llmProvider, customModelName } = processedSettings;
      processedSettings = {
        ...DEFAULT_SETTINGS,
        customGuestKey,
        llmProvider,
        customModelName,
      };
    }

    // Ensure web search settings are preserved
    if (typeof processedSettings.enableWebSearch === 'undefined') {
      processedSettings.enableWebSearch = false;
    }

    // Always ensure webSearchProvider is "google"
    processedSettings.webSearchProvider = "google" as const;

    console.log("Final processed settings:", processedSettings);

    // Update state first
    setSettings(processedSettings);

    // Then save to localStorage
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(processedSettings));
      console.log("Settings saved to localStorage successfully");
    } catch (error) {
      console.error("Failed to save settings to localStorage:", error);
    }
  }, []);

  const resetSettings = useCallback(() => {
    console.log("Resetting settings to defaults");
    localStorage.removeItem(SETTINGS_KEY);
    setSettings(DEFAULT_SETTINGS);
  }, []);

  const updateProvider = useCallback((provider: LLMProvider) => {
    console.log(`Updating provider from ${settings.llmProvider} to ${provider}`);

    const newSettings: ModelSettings = {
      ...settings,
      llmProvider: provider,
      customModelName: DEFAULT_MODELS[provider], // Always update model when provider changes
      webSearchProvider: "google" as const, // Ensure Google is always set
    };

    console.log(`Provider changed to ${provider}, setting model to ${DEFAULT_MODELS[provider]}`);
    saveSettings(newSettings);
  }, [settings, saveSettings]);

  const updateModel = useCallback((model: string) => {
    console.log(`Updating model from ${settings.customModelName} to ${model}`);

    // Don't update if model is the same
    if (settings.customModelName === model) {
      console.log("Model unchanged, skipping update");
      return;
    }

    const newSettings: ModelSettings = {
      ...settings,
      customModelName: model,
      webSearchProvider: "google" as const, // Ensure Google is always set
    };

    console.log(`Model changed to ${model}`);
    console.log("New settings:", newSettings);

    // Update state immediately for instant UI feedback
    setSettings(newSettings);

    // Then save to localStorage
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
      console.log("Model change saved to localStorage successfully");
    } catch (error) {
      console.error("Failed to save model change to localStorage:", error);
    }
  }, [settings]);

  const getCurrentApiKey = useCallback((): string => {
    const provider = settings.llmProvider || LLM_PROVIDERS.GROQ;

    switch (provider) {
      case LLM_PROVIDERS.GROQ:
        return settings.groqApiKey || settings.customApiKey || "";
      case LLM_PROVIDERS.OPENROUTER:
        return settings.openrouterApiKey || settings.customApiKey || "";
      case LLM_PROVIDERS.COHERE:
        return settings.cohereApiKey || settings.customApiKey || "";
      default:
        return settings.customApiKey || "";
    }
  }, [settings]);

  const isConfigurationValid = useCallback((): boolean => {
    return isGuestMode() || hasValidApiKey(settings);
  }, [settings]);

  const hasValidApiKeyCallback = useCallback(() => {
    return hasValidApiKey(settings);
  }, [settings]);

  return {
    settings,
    saveSettings,
    resetSettings,
    updateProvider,
    updateModel,
    getCurrentApiKey,
    isConfigurationValid,
    hasValidApiKey: hasValidApiKeyCallback,
  };
}