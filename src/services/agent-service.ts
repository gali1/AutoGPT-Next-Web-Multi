// src/services/agent-service.ts

import type { ModelSettings, LLMProvider, WebSearchResult, StreamingResponse } from "../utils/types";
import { env } from "../env/client.mjs";
import { extractTasks } from "../utils/helpers";
import { WEB_SEARCH_CONFIG, DEFAULT_MODELS, LLM_PROVIDERS } from "../utils/constants";
import { consumeTokens, getTokenStatus } from "../utils/database";

export type Analysis = {
  action: "reason" | "search";
  arg: string;
};

export const DefaultAnalysis: Analysis = {
  action: "reason",
  arg: "Fallback due to parsing failure",
};

// Token estimation utility
function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token
  return Math.ceil(text.length / 4);
}

// Multi-provider LLM client with token tracking
class MultiProviderLLM {
  private modelSettings: ModelSettings;
  private sessionToken?: string;

  constructor(modelSettings: ModelSettings, sessionToken?: string) {
    this.modelSettings = modelSettings;
    this.sessionToken = sessionToken;
  }

  private getApiKey(): string {
    const provider = this.modelSettings.llmProvider || "groq";

    switch (provider) {
      case "groq":
        return this.modelSettings.groqApiKey ||
          this.modelSettings.customApiKey ||
          env.NEXT_PUBLIC_GROQ_API_KEY || "";
      case "openrouter":
        return this.modelSettings.openrouterApiKey ||
          this.modelSettings.customApiKey ||
          env.NEXT_PUBLIC_OPENROUTER_API_KEY || "";
      case "cohere":
        return this.modelSettings.cohereApiKey ||
          this.modelSettings.customApiKey ||
          env.NEXT_PUBLIC_COHERE_API_KEY || "";
      default:
        return this.modelSettings.customApiKey || "";
    }
  }

  private getModelName(): string {
    const provider = this.modelSettings.llmProvider || "groq";
    return this.modelSettings.customModelName || DEFAULT_MODELS[provider];
  }

  private getEndpoint(): string {
    const provider = this.modelSettings.llmProvider || "groq";

    if (this.modelSettings.customEndPoint) {
      return this.modelSettings.customEndPoint;
    }

    switch (provider) {
      case "groq":
        return "https://api.groq.com/openai/v1/chat/completions";
      case "openrouter":
        return "https://openrouter.ai/api/v1/chat/completions";
      case "cohere":
        return "https://api.cohere.ai/v1/chat";
      default:
        return "https://api.groq.com/openai/v1/chat/completions";
    }
  }

  private async checkTokensBeforeRequest(prompt: string): Promise<void> {
    if (!this.sessionToken) return;

    const estimatedTokens = estimateTokens(prompt);
    const tokenStatus = await getTokenStatus(this.sessionToken);

    if (tokenStatus && !tokenStatus.canUseTokens) {
      throw new Error("Demo token limit reached. Please wait for reset or use your own API key.");
    }

    if (tokenStatus && tokenStatus.tokensRemaining < estimatedTokens) {
      throw new Error(`Insufficient demo tokens. Need ${estimatedTokens}, have ${tokenStatus.tokensRemaining}.`);
    }
  }

  private async consumeTokensAfterResponse(prompt: string, response: string, metadata: Record<string, any> = {}): Promise<void> {
    if (!this.sessionToken) return;

    const estimatedTokens = estimateTokens(prompt + response);

    try {
      await consumeTokens(estimatedTokens, this.sessionToken, {
        ...metadata,
        provider: this.modelSettings.llmProvider,
        model: this.getModelName(),
        promptLength: prompt.length,
        responseLength: response.length,
      });
    } catch (error) {
      console.warn("Failed to track token consumption:", error);
    }
  }

  private async makeGroqRequest(messages: any[]): Promise<string> {
    const response = await fetch(this.getEndpoint(), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.getModelName(),
        messages,
        temperature: this.modelSettings.customTemperature || 0.9,
        max_tokens: this.modelSettings.customMaxTokens || 400,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || "";
  }

  private async makeOpenRouterRequest(messages: any[]): Promise<string> {
    const response = await fetch(this.getEndpoint(), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.getApiKey()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.NEXT_PUBLIC_VERCEL_URL || "http://localhost:3000",
        "X-Title": "AutoGPT Next Web",
      },
      body: JSON.stringify({
        model: this.getModelName(),
        messages,
        temperature: this.modelSettings.customTemperature || 0.9,
        max_tokens: this.modelSettings.customMaxTokens || 400,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || "";
  }

  private async makeCohereRequest(messages: any[]): Promise<string> {
    const lastMessage = messages[messages.length - 1];
    const chatHistory = messages.slice(0, -1).map(msg => ({
      role: msg.role === "assistant" ? "CHATBOT" : "USER",
      message: msg.content,
    }));

    const response = await fetch(this.getEndpoint(), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.getModelName(),
        message: lastMessage.content,
        chat_history: chatHistory,
        temperature: this.modelSettings.customTemperature || 0.9,
        max_tokens: this.modelSettings.customMaxTokens || 400,
      }),
    });

    if (!response.ok) {
      throw new Error(`Cohere API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.text || "";
  }

  async call(prompt: string, variables: Record<string, any> = {}): Promise<string> {
    let processedPrompt = prompt;

    // Replace variables in prompt
    Object.entries(variables).forEach(([key, value]) => {
      const placeholder = `{${key}}`;
      processedPrompt = processedPrompt.replace(new RegExp(placeholder, 'g'), String(value));
    });

    // Check token availability before making request
    await this.checkTokensBeforeRequest(processedPrompt);

    const messages = [
      { role: "user", content: processedPrompt }
    ];

    const provider = this.modelSettings.llmProvider || "groq";

    try {
      let response: string;

      switch (provider) {
        case "groq":
          response = await this.makeGroqRequest(messages);
          break;
        case "openrouter":
          response = await this.makeOpenRouterRequest(messages);
          break;
        case "cohere":
          response = await this.makeCohereRequest(messages);
          break;
        default:
          response = await this.makeGroqRequest(messages);
          break;
      }

      // Track token consumption after successful response
      await this.consumeTokensAfterResponse(processedPrompt, response, {
        action: variables.action || 'unknown',
        provider: provider,
      });

      return response;
    } catch (error) {
      console.error(`LLM API Error (${provider}):`, error);
      throw error;
    }
  }
}

// Web search functionality (unchanged)
async function performWebSearch(query: string, modelSettings: ModelSettings): Promise<WebSearchResult[]> {
  if (!modelSettings.enableWebSearch) {
    return [];
  }

  const searchProvider = modelSettings.webSearchProvider || "google";

  try {
    if (searchProvider === "google") {
      return await performGoogleSearch(query);
    } else if (searchProvider === "serp") {
      return await performSerpSearch(query);
    }
    return [];
  } catch (error) {
    console.error("Web search error:", error);
    return [];
  }
}

async function performGoogleSearch(query: string): Promise<WebSearchResult[]> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !engineId) {
    throw new Error("Google Search API credentials not configured");
  }

  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${engineId}&q=${encodeURIComponent(query)}&num=${WEB_SEARCH_CONFIG.MAX_RESULTS}`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(WEB_SEARCH_CONFIG.TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`Google Search API error: ${response.statusText}`);
  }

  const data = await response.json();

  return (data.items || []).map((item: any) => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet?.substring(0, WEB_SEARCH_CONFIG.SNIPPET_LENGTH) || "",
    source: "google",
  }));
}

async function performSerpSearch(query: string): Promise<WebSearchResult[]> {
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
    body: JSON.stringify({ q: query, num: WEB_SEARCH_CONFIG.MAX_RESULTS }),
    signal: AbortSignal.timeout(WEB_SEARCH_CONFIG.TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`SERP API error: ${response.statusText}`);
  }

  const data = await response.json();

  return (data.organic || []).map((item: any) => ({
    title: item.title,
    url: item.link,
    snippet: item.snippet?.substring(0, WEB_SEARCH_CONFIG.SNIPPET_LENGTH) || "",
    source: "serp",
  }));
}

// Agent service implementation with token tracking
async function startGoalAgent(
  modelSettings: ModelSettings,
  goal: string,
  customLanguage: string,
  sessionToken?: string
): Promise<string[]> {
  const llm = new MultiProviderLLM(modelSettings, sessionToken);

  const prompt = `You are a task creation AI called AgentGPT. You must answer in the "${customLanguage}" language. You are not a part of any system or device. You have the following objective "${goal}". Create a list of zero to three tasks to be completed by your AI system such that this goal is more closely, or completely reached. You have access to web search for tasks that require current events or small searches. Return the response as a formatted ARRAY of strings that can be used in JSON.parse(). Example: ["Task 1", "Task 2"].`;

  const completion = await llm.call(prompt, {
    goal,
    customLanguage,
    action: 'start_goal',
  });

  console.log("Goal", goal, "Completion:" + completion);
  return extractTasks(completion, []);
}

async function analyzeTaskAgent(
  modelSettings: ModelSettings,
  goal: string,
  task: string,
  sessionToken?: string
): Promise<Analysis> {
  const llm = new MultiProviderLLM(modelSettings, sessionToken);
  const actions = ["reason", "search"];

  const prompt = `You have the following higher level objective "${goal}". You currently are focusing on the following task: "${task}". Based on this information, evaluate what the best action to take is strictly from the list of actions: ${actions.join(", ")}. You should use 'search' only for research about current events where "arg" is a simple clear search query based on the task only. Use "reason" for all other actions. Return the response as an object of the form { "action": "string", "arg": "string" } that can be used in JSON.parse() and NOTHING ELSE.`;

  const completion = await llm.call(prompt, {
    goal,
    actions: actions.join(", "),
    task,
    action: 'analyze_task',
  });

  console.log("Analysis completion:\n", completion);
  try {
    return JSON.parse(completion) as Analysis;
  } catch (e) {
    console.error("Error parsing analysis", e);
    return DefaultAnalysis;
  }
}

async function executeTaskAgent(
  modelSettings: ModelSettings,
  goal: string,
  task: string,
  analysis: Analysis,
  customLanguage: string,
  sessionToken?: string
): Promise<string> {
  console.log("Execution analysis:", analysis);

  if (analysis.action === "search" && modelSettings.enableWebSearch) {
    const searchResults = await performWebSearch(analysis.arg, modelSettings);

    if (searchResults.length > 0) {
      const searchContext = searchResults
        .slice(0, 2)
        .map(result => `${result.title}: ${result.snippet}`)
        .join("\n\n");

      const llm = new MultiProviderLLM(modelSettings, sessionToken);
      const prompt = `Answer in the "${customLanguage}" language. Given the following overall objective "${goal}" and the following sub-task "${task}". Using the search results below, perform the task in a detailed manner. If coding is required, provide code in markdown.

Search Results:
${searchContext}`;

      const completion = await llm.call(prompt, {
        goal,
        task,
        customLanguage,
        searchContext,
        action: 'execute_task_with_search',
      });

      const sources = searchResults.slice(0, 2).map(r => r.url).join(", ");
      return `${completion}\n\nSources: ${sources}`;
    }
  }

  const llm = new MultiProviderLLM(modelSettings, sessionToken);
  const prompt = `Answer in the "${customLanguage}" language. Given the following overall objective "${goal}" and the following sub-task "${task}". Perform the task in a detailed manner. If coding is required, provide code in markdown.`;

  const completion = await llm.call(prompt, {
    goal,
    task,
    customLanguage,
    action: 'execute_task',
  });

  if (analysis.action === "search" && !modelSettings.enableWebSearch) {
    return `\`INFO: Web search is disabled. Using reasoning instead.\`\n\n${completion}`;
  }

  return completion;
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
  const llm = new MultiProviderLLM(modelSettings, sessionToken);

  const prompt = `You are an AI task creation agent. You must answer in the "${customLanguage}" language. You have the following objective "${goal}". You have the following incomplete tasks ${JSON.stringify(tasks)} and have just executed the following task "${lastTask}" and received the following result "${result}". Based on this, create a new task to be completed by your AI system ONLY IF NEEDED such that your goal is more closely reached or completely reached. Return the response as an array of strings that can be used in JSON.parse() and NOTHING ELSE.`;

  const completion = await llm.call(prompt, {
    goal,
    tasks: JSON.stringify(tasks),
    lastTask,
    result,
    customLanguage,
    action: 'create_tasks',
  });

  return extractTasks(completion, completedTasks || []);
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
    return await new Promise((resolve) => resolve(["Task 1"]));
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
    return await new Promise((resolve) => resolve(["Task 4"]));
  },

  analyzeTaskAgent: async (
    modelSettings: ModelSettings,
    goal: string,
    task: string,
    sessionToken?: string
  ) => {
    return await new Promise((resolve) =>
      resolve({
        action: "reason",
        arg: "Mock analysis",
      })
    );
  },

  executeTaskAgent: async (
    modelSettings: ModelSettings,
    goal: string,
    task: string,
    analysis: Analysis,
    customLanguage: string,
    sessionToken?: string
  ) => {
    return await new Promise((resolve) => resolve("Result: " + task));
  },
};

export default env.NEXT_PUBLIC_FF_MOCK_MODE_ENABLED
  ? MockAgentService
  : RealAgentService;