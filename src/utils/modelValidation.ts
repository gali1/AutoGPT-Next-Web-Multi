// src/utils/modelValidation.ts

import type { LLMProvider } from "./types";
import { LLM_PROVIDERS, DEFAULT_MODELS, GROQ_MODELS, OPENROUTER_MODELS, COHERE_MODELS } from "./constants";

// Type-safe model validation helper
export function getModelsForProvider(provider: LLMProvider): string[] {
    console.log("Getting models for provider:", provider);

    switch (provider) {
        case LLM_PROVIDERS.GROQ:
            return [...GROQ_MODELS];
        case LLM_PROVIDERS.OPENROUTER:
            return [...OPENROUTER_MODELS];
        case LLM_PROVIDERS.COHERE:
            return [...COHERE_MODELS];
        default:
            console.warn("Unknown provider:", provider, "returning Groq models");
            return [...GROQ_MODELS];
    }
}

export function isValidModelForProvider(model: string, provider: LLMProvider): boolean {
    const availableModels = getModelsForProvider(provider);
    const isValid = availableModels.includes(model);
    console.log(`Validating model ${model} for provider ${provider}: ${isValid}`);
    return isValid;
}

export function getValidModelForProvider(model: string | undefined, provider: LLMProvider): string {
    console.log(`Getting valid model for provider ${provider}, input model: ${model}`);

    // If no model provided, return default
    if (!model || model.trim() === "") {
        const defaultModel = DEFAULT_MODELS[provider];
        console.log(`No model provided, returning default: ${defaultModel}`);
        return defaultModel;
    }

    // If model is valid for provider, return it
    if (isValidModelForProvider(model, provider)) {
        console.log(`Model ${model} is valid for provider ${provider}`);
        return model;
    }

    // If model is not valid for provider, return default
    const defaultModel = DEFAULT_MODELS[provider];
    console.log(`Model ${model} not valid for provider ${provider}, returning default: ${defaultModel}`);
    return defaultModel;
}