// src/hooks/useSettings.ts

import { useState } from "react";
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
  webSearchProvider: "google",
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

  // Set default model for provider if not set OR if current model doesn't belong to the provider
  const currentProvider = defaultSettings.llmProvider;
  const currentModel = defaultSettings.customModelName;

  // Check if current model belongs to current provider
  const isValidModelForProvider = (() => {
    switch (currentProvider) {
      case LLM_PROVIDERS.GROQ:
        return import("../utils/constants").then(c => c.GROQ_MODELS.includes(currentModel as any));
      case LLM_PROVIDERS.OPENROUTER:
        return import("../utils/constants").then(c => c.OPENROUTER_MODELS.includes(currentModel as any));
      case LLM_PROVIDERS.COHERE:
        return import("../utils/constants").then(c => c.COHERE_MODELS.includes(currentModel as any));
      default:
        return Promise.resolve(false);
    }
  });

  // If no model or invalid model for provider, set default
  if (!currentModel) {
    defaultSettings.customModelName = DEFAULT_MODELS[currentProvider];
  }

  // Reset to defaults if no API key and not guest mode
  if (!isGuestMode() && !hasValidApiKey(defaultSettings)) {
    return { ...DEFAULT_SETTINGS };
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

  const saveSettings = (newSettings: ModelSettings) => {
    let processedSettings = { ...newSettings };

    // Ensure provider is valid
    if (!processedSettings.llmProvider || !Object.values(LLM_PROVIDERS).includes(processedSettings.llmProvider)) {
      processedSettings.llmProvider = LLM_PROVIDERS.GROQ;
    }

    // Validate model belongs to provider - if not, set default
    const provider = processedSettings.llmProvider;
    const model = processedSettings.customModelName;

    const getModelsForProvider = (p: LLMProvider) => {
      switch (p) {
        case LLM_PROVIDERS.GROQ:
          return import("../utils/constants").then(c => c.GROQ_MODELS);
        case LLM_PROVIDERS.OPENROUTER:
          return import("../utils/constants").then(c => c.OPENROUTER_MODELS);
        case LLM_PROVIDERS.COHERE:
          return import("../utils/constants").then(c => c.COHERE_MODELS);
        default:
          return Promise.resolve([]);
      }
    };

    // Check if model is valid for provider
    getModelsForProvider(provider).then(models => {
      if (!model || !models.includes(model as any)) {
        processedSettings.customModelName = DEFAULT_MODELS[provider];
        console.log(`Model ${model} invalid for provider ${provider}, setting to default: ${DEFAULT_MODELS[provider]}`);
      }
    });

    // If no model specified, set default for provider
    if (!processedSettings.customModelName) {
      processedSettings.customModelName = DEFAULT_MODELS[processedSettings.llmProvider];
    }

    // Reset to defaults if no API key and not guest mode
    if (!hasValidApiKey(processedSettings) && !isGuestMode()) {
      const { customGuestKey } = processedSettings;
      processedSettings = {
        ...DEFAULT_SETTINGS,
        customGuestKey,
      };
    }

    // Ensure web search settings are preserved
    if (typeof processedSettings.enableWebSearch === 'undefined') {
      processedSettings.enableWebSearch = false;
    }

    if (!processedSettings.webSearchProvider) {
      processedSettings.webSearchProvider = "google";
    }

    console.log("Saving settings:", processedSettings);
    setSettings(processedSettings);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(processedSettings));
  };

  const resetSettings = () => {
    localStorage.removeItem(SETTINGS_KEY);
    setSettings(DEFAULT_SETTINGS);
  };

  const updateProvider = (provider: LLMProvider) => {
    const newSettings = {
      ...settings,
      llmProvider: provider,
      customModelName: DEFAULT_MODELS[provider], // Always update model when provider changes
    };
    console.log(`Provider changed to ${provider}, setting model to ${DEFAULT_MODELS[provider]}`);
    saveSettings(newSettings);
  };

  const updateModel = (model: string) => {
    const newSettings = {
      ...settings,
      customModelName: model,
    };
    console.log(`Model changed to ${model}`);
    saveSettings(newSettings);
  };

  const getCurrentApiKey = (): string => {
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
  };

  const isConfigurationValid = (): boolean => {
    return isGuestMode() || hasValidApiKey(settings);
  };

  return {
    settings,
    saveSettings,
    resetSettings,
    updateProvider,
    updateModel, // Add this new method
    getCurrentApiKey,
    isConfigurationValid,
    hasValidApiKey: () => hasValidApiKey(settings),
  };
}