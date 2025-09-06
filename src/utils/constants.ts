// src/utils/constants.ts

// Groq Models
export const GROQ_DEEPSEEK_R1 = "deepseek-r1-distill-llama-70b" as const;
export const GROQ_LLAMA_4_SCOUT = "meta-llama/llama-4-scout-17b-16e-instruct" as const;
export const GROQ_LLAMA_4_MAVERICK = "meta-llama/llama-4-maverick-17b-128e-instruct" as const;
export const GROQ_COMPOUND_BETA = "compound-beta" as const;
export const GROQ_KIMI_K2 = "moonshotai/kimi-k2-instruct" as const;
export const GROQ_GPT_OSS = "openai/gpt-oss-120b" as const;
export const GROQ_LLAMA_3_8B = "llama3-8b-8192" as const;
export const GROQ_LLAMA_3_1_8B = "llama-3.1-8b-instant" as const;
export const GROQ_LLAMA_3_3_70B = "llama-3.3-70b-versatile" as const;

// OpenRouter Models
export const OPENROUTER_QWEN_CODER = "qwen/qwen3-coder:free" as const;
export const OPENROUTER_DEEPSEEK_R1T = "tngtech/deepseek-r1t-chimera:free" as const;
export const OPENROUTER_KIMI_K2 = "moonshotai/kimi-k2:free" as const;
export const OPENROUTER_GEMINI_2 = "google/gemini-2.0-flash-exp:free" as const;
export const OPENROUTER_MAI_DS_R1 = "microsoft/mai-ds-r1:free" as const;
export const OPENROUTER_LLAMA_3_3_70B = "meta-llama/llama-3.3-70b-instruct:free" as const;
export const OPENROUTER_MISTRAL_SMALL = "mistralai/mistral-small-3.2-24b-instruct:free" as const;
export const OPENROUTER_DOLPHIN_MISTRAL = "cognitivecomputations/dolphin-mistral-24b-venice-edition:free" as const;

// Cohere Models
export const COHERE_COMMAND_NIGHTLY = "command-nightly" as const;
export const COHERE_COMMAND_R = "command-r" as const;
export const COHERE_COMMAND_R_03 = "command-r-03-2024" as const;
export const COHERE_COMMAND_R_08 = "command-r-08-2024" as const;
export const COHERE_COMMAND_R_PLUS = "command-r-plus" as const;
export const COHERE_COMMAND_LIGHT_NIGHTLY = "command-light-nightly" as const;
export const COHERE_COMMAND_LIGHT = "command-light" as const;
export const COHERE_COMMAND = "command" as const;

// LLM Providers
export const LLM_PROVIDERS = {
  GROQ: "groq" as const,
  OPENROUTER: "openrouter" as const,
  COHERE: "cohere" as const,
} as const;

// Model collections by provider
export const GROQ_MODELS = [
  GROQ_DEEPSEEK_R1,
  GROQ_LLAMA_4_SCOUT,
  GROQ_LLAMA_4_MAVERICK,
  GROQ_COMPOUND_BETA,
  GROQ_KIMI_K2,
  GROQ_GPT_OSS,
  GROQ_LLAMA_3_8B,
  GROQ_LLAMA_3_1_8B,
  GROQ_LLAMA_3_3_70B,
] as const;

export const OPENROUTER_MODELS = [
  OPENROUTER_QWEN_CODER,
  OPENROUTER_DEEPSEEK_R1T,
  OPENROUTER_KIMI_K2,
  OPENROUTER_GEMINI_2,
  OPENROUTER_MAI_DS_R1,
  OPENROUTER_LLAMA_3_3_70B,
  OPENROUTER_MISTRAL_SMALL,
  OPENROUTER_DOLPHIN_MISTRAL,
] as const;

export const COHERE_MODELS = [
  COHERE_COMMAND_NIGHTLY,
  COHERE_COMMAND_R,
  COHERE_COMMAND_R_03,
  COHERE_COMMAND_R_08,
  COHERE_COMMAND_R_PLUS,
  COHERE_COMMAND_LIGHT_NIGHTLY,
  COHERE_COMMAND_LIGHT,
  COHERE_COMMAND,
] as const;

// All models combined
export const ALL_MODEL_NAMES = [
  ...GROQ_MODELS,
  ...OPENROUTER_MODELS,
  ...COHERE_MODELS,
] as const;

// Default models per provider
export const DEFAULT_MODELS = {
  [LLM_PROVIDERS.GROQ]: GROQ_LLAMA_3_3_70B,
  [LLM_PROVIDERS.OPENROUTER]: OPENROUTER_LLAMA_3_3_70B,
  [LLM_PROVIDERS.COHERE]: COHERE_COMMAND_R_PLUS,
} as const;

// Provider display names
export const PROVIDER_NAMES = {
  [LLM_PROVIDERS.GROQ]: "Groq",
  [LLM_PROVIDERS.OPENROUTER]: "OpenRouter",
  [LLM_PROVIDERS.COHERE]: "Cohere",
} as const;

// Model display names
export const MODEL_DISPLAY_NAMES = {
  [GROQ_DEEPSEEK_R1]: "DeepSeek R1 Distill Llama 70B",
  [GROQ_LLAMA_4_SCOUT]: "Llama 4 Scout 17B",
  [GROQ_LLAMA_4_MAVERICK]: "Llama 4 Maverick 17B",
  [GROQ_COMPOUND_BETA]: "Compound Beta",
  [GROQ_KIMI_K2]: "Kimi K2 Instruct",
  [GROQ_GPT_OSS]: "GPT OSS 120B",
  [GROQ_LLAMA_3_8B]: "Llama 3 8B",
  [GROQ_LLAMA_3_1_8B]: "Llama 3.1 8B Instant",
  [GROQ_LLAMA_3_3_70B]: "Llama 3.3 70B Versatile",
  [OPENROUTER_QWEN_CODER]: "Qwen 3 Coder (Free)",
  [OPENROUTER_DEEPSEEK_R1T]: "DeepSeek R1T Chimera (Free)",
  [OPENROUTER_KIMI_K2]: "Kimi K2 (Free)",
  [OPENROUTER_GEMINI_2]: "Gemini 2.0 Flash (Free)",
  [OPENROUTER_MAI_DS_R1]: "MAI DS R1 (Free)",
  [OPENROUTER_LLAMA_3_3_70B]: "Llama 3.3 70B (Free)",
  [OPENROUTER_MISTRAL_SMALL]: "Mistral Small 3.2 24B (Free)",
  [OPENROUTER_DOLPHIN_MISTRAL]: "Dolphin Mistral 24B (Free)",
  [COHERE_COMMAND_NIGHTLY]: "Command Nightly",
  [COHERE_COMMAND_R]: "Command R",
  [COHERE_COMMAND_R_03]: "Command R (March 2024)",
  [COHERE_COMMAND_R_08]: "Command R (August 2024)",
  [COHERE_COMMAND_R_PLUS]: "Command R+",
  [COHERE_COMMAND_LIGHT_NIGHTLY]: "Command Light Nightly",
  [COHERE_COMMAND_LIGHT]: "Command Light",
  [COHERE_COMMAND]: "Command",
} as const;

export const DEFAULT_MAX_LOOPS_FREE = 4 as const;
export const DEFAULT_MAX_LOOPS_PAID = 16 as const;
export const DEFAULT_MAX_LOOPS_CUSTOM_API_KEY = 50 as const;
export const DEFAULT_MAX_TOKENS = 400 as const;
export const DEFAULT_TEMPERATURE = 0.9 as const;

// Demo Token System
export const DEMO_TOKEN_LIMIT = 10000 as const;
export const TOKEN_RESET_HOURS = 24 as const;

// Web Search Configuration
export const WEB_SEARCH_CONFIG = {
  MAX_RESULTS: 10,
  SNIPPET_LENGTH: 200,
  TIMEOUT: 10000,
} as const;