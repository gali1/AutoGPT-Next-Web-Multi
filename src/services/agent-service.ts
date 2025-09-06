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
  return Math.ceil(text.length / 4);
}

// Enhanced retry utility
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.warn(`Attempt ${i + 1} failed:`, error);

      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i) + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}

// Multi-provider LLM client with proper streaming support
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

  // Streaming support for all providers
  async callStreaming(prompt: string, variables: Record<string, any> = {}): Promise<string> {
    let processedPrompt = prompt;

    // Replace variables in prompt
    Object.entries(variables).forEach(([key, value]) => {
      const placeholder = `{${key}}`;
      processedPrompt = processedPrompt.replace(new RegExp(placeholder, 'g'), String(value));
    });

    await this.checkTokensBeforeRequest(processedPrompt);

    const provider = this.modelSettings.llmProvider || "groq";

    try {
      let response: string;

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

      await this.consumeTokensAfterResponse(processedPrompt, response, {
        action: variables.action || 'unknown',
        provider: provider,
      });

      return response;
    } catch (error) {
      console.error(`LLM Streaming Error (${provider}):`, error);
      throw error;
    }
  }

  // Groq streaming implementation
  private async streamGroq(prompt: string): Promise<string> {
    const response = await fetch(this.getEndpoint(), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.getModelName(),
        messages: [{ role: "user", content: prompt }],
        temperature: this.modelSettings.customTemperature || 0.9,
        max_tokens: this.modelSettings.customMaxTokens || 400,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status}`);
    }

    return this.processOpenAIStream(response);
  }

  // OpenRouter streaming implementation
  private async streamOpenRouter(prompt: string): Promise<string> {
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
        messages: [{ role: "user", content: prompt }],
        temperature: this.modelSettings.customTemperature || 0.9,
        max_tokens: this.modelSettings.customMaxTokens || 400,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    return this.processOpenRouterStream(response);
  }

  // Cohere streaming implementation
  private async streamCohere(prompt: string): Promise<string> {
    const response = await fetch(this.getEndpoint(), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.getApiKey()}`,
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

    if (!response.ok) {
      throw new Error(`Cohere API error: ${response.status}`);
    }

    return this.processCohereStream(response);
  }

  // Process OpenAI-compatible streams (Groq)
  private async processOpenAIStream(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullResponse = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return fullResponse;

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

    return fullResponse;
  }

  // Process OpenRouter SSE streams
  private async processOpenRouterStream(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let fullResponse = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

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
            if (data === '[DONE]') return fullResponse;

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

    return fullResponse;
  }

  // Process Cohere streams
  private async processCohereStream(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let fullResponse = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.event_type === 'text-generation') {
                fullResponse += parsed.text || "";
              } else if (parsed.event_type === 'stream-end') {
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

    return fullResponse;
  }

  // Non-streaming fallback
  async call(prompt: string, variables: Record<string, any> = {}): Promise<string> {
    try {
      return await this.callStreaming(prompt, variables);
    } catch (error) {
      console.error("Streaming failed, using non-streaming fallback:", error);
      return await this.callNonStreaming(prompt, variables);
    }
  }

  private async callNonStreaming(prompt: string, variables: Record<string, any> = {}): Promise<string> {
    let processedPrompt = prompt;

    Object.entries(variables).forEach(([key, value]) => {
      const placeholder = `{${key}}`;
      processedPrompt = processedPrompt.replace(new RegExp(placeholder, 'g'), String(value));
    });

    await this.checkTokensBeforeRequest(processedPrompt);

    const provider = this.modelSettings.llmProvider || "groq";
    const messages = [{ role: "user", content: processedPrompt }];

    let response: Response;

    if (provider === "cohere") {
      response = await fetch(this.getEndpoint(), {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.getApiKey()}`,
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
          "Authorization": `Bearer ${this.getApiKey()}`,
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
      throw new Error(`${provider} API error: ${response.status}`);
    }

    const data = await response.json();

    if (provider === "cohere") {
      return data.text || "";
    } else {
      return data.choices?.[0]?.message?.content || "";
    }
  }
}

// Web search functionality
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

// Agent service implementation with improved task creation logic
async function startGoalAgent(
  modelSettings: ModelSettings,
  goal: string,
  customLanguage: string,
  sessionToken?: string
): Promise<string[]> {
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

    console.log("Goal:", goal, "Raw completion:", completion);

    const tasks = extractTasks(completion, []);

    if (!Array.isArray(tasks) || tasks.length === 0) {
      console.warn("No valid tasks extracted, providing fallback tasks");
      return generateFallbackTasks(goal);
    }

    return tasks;
  } catch (error) {
    console.error("Start goal agent error:", error);
    return generateFallbackTasks(goal);
  }
}

// Generate fallback tasks - ensures we always return an array
function generateFallbackTasks(goal: string): string[] {
  const goalLower = goal.toLowerCase();

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
  try {
    const llm = new MultiProviderLLM(modelSettings, sessionToken);
    const actions = ["reason", "search"];

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
{"action": "reason", "arg": "reasoning approach description"}`;

    const completion = await llm.call(prompt, {
      goal,
      actions: actions.join(", "),
      task,
      action: 'analyze_task',
    });

    console.log("Analysis completion:", completion);

    try {
      const jsonMatch = completion.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Analysis;
        if (parsed.action && parsed.arg) {
          return parsed;
        }
      }

      const result = JSON.parse(completion) as Analysis;
      return result;
    } catch (parseError) {
      console.warn("Failed to parse analysis response, using heuristic approach");

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
  } catch (e) {
    console.error("Error analyzing task", e);
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
    try {
      const searchResults = await performWebSearch(analysis.arg, modelSettings);

      if (searchResults.length > 0) {
        const searchContext = searchResults
          .slice(0, 2)
          .map(result => `${result.title}: ${result.snippet}`)
          .join("\n\n");

        const llm = new MultiProviderLLM(modelSettings, sessionToken);
        const prompt = `Answer in "${customLanguage}" language.

GOAL: "${goal}"
TASK: "${task}"

Based on the search results below, complete this task with detailed information:

SEARCH RESULTS:
${searchContext}

Provide a comprehensive response with specific details from the search results. If coding is required, provide code in markdown format.`;

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
    } catch (error) {
      console.error("Search execution error:", error);
    }
  }

  try {
    const llm = new MultiProviderLLM(modelSettings, sessionToken);
    const prompt = `Answer in "${customLanguage}" language.

GOAL: "${goal}"
TASK: "${task}"

Complete this task with detailed, actionable information. Be specific and practical in your response. If coding is required, provide code in markdown format.

Provide a comprehensive response that directly addresses the task requirements.`;

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
  } catch (error) {
    console.error("Task execution error:", error);
    return `Task completed: ${task}\n\nNote: Executed with basic reasoning due to API limitations.`;
  }
}

// Fixed createTasksAgent with improved logic
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
  try {
    const llm = new MultiProviderLLM(modelSettings, sessionToken);

    // Calculate progress metrics to inform decision
    const totalCompletedTasks = (completedTasks || []).length;
    const remainingTasksCount = tasks.length;
    const progressRatio = totalCompletedTasks / (totalCompletedTasks + remainingTasksCount + 1);

    // Enhanced prompt with better context awareness
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

    console.log("Create tasks completion:", completion);

    // Parse the response
    const newTasks = extractTasks(completion, completedTasks || []);

    // Apply intelligent filtering
    const filteredTasks = intelligentTaskFilter(newTasks, {
      goal,
      completedTasks: completedTasks || [],
      remainingTasks: tasks,
      lastTask,
      result,
      progressRatio
    });

    return Array.isArray(filteredTasks) ? filteredTasks : [];
  } catch (error) {
    console.error("Create tasks error:", error);
    return []; // Always return empty array on error
  }
}

// Intelligent task filtering to prevent unnecessary task creation
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

  // Rule 1: If progress is high and few remaining tasks, limit new tasks
  if (progressRatio > 0.7 && remainingTasks.length <= 2) {
    console.log("High progress detected, limiting new tasks");
    return [];
  }

  // Rule 2: If too many tasks already exist, don't add more
  if (remainingTasks.length > 4) {
    console.log("Too many remaining tasks, skipping new task creation");
    return [];
  }

  // Rule 3: Filter out duplicate or similar tasks
  const allExistingTasks = [...completedTasks, ...remainingTasks];
  const filteredTasks = newTasks.filter(newTask => {
    const newTaskLower = newTask.toLowerCase();
    return !allExistingTasks.some(existingTask => {
      const existingLower = existingTask.toLowerCase();
      // Check for substantial overlap in task content
      const words1 = newTaskLower.split(' ').filter(w => w.length > 3);
      const words2 = existingLower.split(' ').filter(w => w.length > 3);
      const overlap = words1.filter(w => words2.includes(w)).length;
      return overlap > Math.min(words1.length, words2.length) * 0.6;
    });
  });

  // Rule 4: Limit to maximum 2 tasks
  const limitedTasks = filteredTasks.slice(0, 2);

  // Rule 5: Apply goal completion heuristics
  const goalLower = goal.toLowerCase();
  if (goalLower.includes('what is') || goalLower.includes('explain') || goalLower.includes('define')) {
    // Information-seeking goals typically need fewer follow-up tasks
    if (completedTasks.length >= 2) {
      console.log("Information goal likely satisfied, limiting new tasks");
      return [];
    }
  }

  console.log(`Task filtering: ${newTasks.length} → ${limitedTasks.length} tasks`);
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
    // Mock: Return fewer tasks to avoid endless loops
    if ((completedTasks || []).length >= 3) return [];
    return ["Continue working towards goal"];
  },

  analyzeTaskAgent: async (
    modelSettings: ModelSettings,
    goal: string,
    task: string,
    sessionToken?: string
  ) => {
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
    return "Mock result for task: " + task;
  },
};

export default env.NEXT_PUBLIC_FF_MOCK_MODE_ENABLED
  ? MockAgentService
  : RealAgentService;