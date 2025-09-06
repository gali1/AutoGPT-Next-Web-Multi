// src/utils/modelValidation.ts

import type { LLMProvider } from "./types";
import { LLM_PROVIDERS, DEFAULT_MODELS } from "./constants";

// Type-safe model validation helper
export function getModelsForProvider(provider: LLMProvider): string[] {
    switch (provider) {
        case LLM_PROVIDERS.GROQ:
            return [
                "deepseek-r1-distill-llama-70b",
                "meta-llama/llama-4-scout-17b-16e-instruct",
                "meta-llama/llama-4-maverick-17b-128e-instruct",
                "compound-beta",
                "moonshotai/kimi-k2-instruct",
                "openai/gpt-oss-120b",
                "llama3-8b-8192",
                "llama-3.1-8b-instant",
                "llama-3.3-70b-versatile"
            ];
        case LLM_PROVIDERS.OPENROUTER:
            return [
                "qwen/qwen3-coder:free",
                "tngtech/deepseek-r1t-chimera:free",
                "moonshotai/kimi-k2:free",
                "google/gemini-2.0-flash-exp:free",
                "microsoft/mai-ds-r1:free",
                "meta-llama/llama-3.3-70b-instruct:free",
                "mistralai/mistral-small-3.2-24b-instruct:free",
                "cognitivecomputations/dolphin-mistral-24b-venice-edition:free"
            ];
        case LLM_PROVIDERS.COHERE:
            return [
                "command-nightly",
                "command-r",
                "command-r-03-2024",
                "command-r-08-2024",
                "command-r-plus",
                "command-light-nightly",
                "command-light",
                "command"
            ];
        default:
            return [];
    }
}

export function isValidModelForProvider(model: string, provider: LLMProvider): boolean {
    const availableModels = getModelsForProvider(provider);
    return availableModels.includes(model);
}

export function getValidModelForProvider(model: string | undefined, provider: LLMProvider): string {
    if (!model) {
        return DEFAULT_MODELS[provider];
    }

    if (isValidModelForProvider(model, provider)) {
        return model;
    }

    console.warn(`Model ${model} not valid for provider ${provider}, using default`);
    return DEFAULT_MODELS[provider];
}