// src/components/AutonomousAgent.ts

import axios from "axios";
import type { ModelSettings, GuestSettings } from "../utils/types";
import type { Analysis } from "../services/agent-service";
import AgentService from "../services/agent-service";
import {
  DEFAULT_MAX_LOOPS_CUSTOM_API_KEY,
  DEFAULT_MAX_LOOPS_FREE,
  DEFAULT_MAX_LOOPS_PAID,
} from "../utils/constants";
import type { Session } from "next-auth";
import { v4, v1 } from "uuid";
import type { RequestBody } from "../utils/interfaces";
import {
  AUTOMATIC_MODE,
  PAUSE_MODE,
  AGENT_PLAY,
  AGENT_PAUSE,
  TASK_STATUS_STARTED,
  TASK_STATUS_EXECUTING,
  TASK_STATUS_COMPLETED,
  TASK_STATUS_FINAL,
  MESSAGE_TYPE_TASK,
  MESSAGE_TYPE_GOAL,
  MESSAGE_TYPE_THINKING,
  MESSAGE_TYPE_SYSTEM,
} from "../types/agentTypes";
import type {
  AgentMode,
  Message,
  Task,
  AgentPlaybackControl,
} from "../types/agentTypes";
import { useAgentStore, useMessageStore } from "./stores";
import { i18n } from "next-i18next";
import { getSessionToken } from "../utils/database";

const TIMEOUT_LONG = 1000;
const TIMOUT_SHORT = 800;

class AutonomousAgent {
  name: string;
  goal: string;
  renderMessage: (message: Message) => void;
  handlePause: (opts: { agentPlaybackControl?: AgentPlaybackControl }) => void;
  shutdown: () => void;
  modelSettings: ModelSettings;
  customLanguage: string;
  guestSettings: GuestSettings;
  session?: Session;
  _id: string;
  mode: AgentMode;
  playbackControl: AgentPlaybackControl;
  sessionToken: string;

  completedTasks: string[] = [];
  isRunning = false;
  numLoops = 0;
  currentTask?: Task;

  constructor(
    name: string,
    goal: string,
    renderMessage: (message: Message) => void,
    handlePause: (opts: {
      agentPlaybackControl?: AgentPlaybackControl;
    }) => void,
    shutdown: () => void,
    modelSettings: ModelSettings,
    mode: AgentMode,
    customLanguage: string,
    guestSettings: GuestSettings,
    session?: Session,
    playbackControl?: AgentPlaybackControl
  ) {
    this.name = name;
    this.goal = goal;
    this.renderMessage = renderMessage;
    this.handlePause = handlePause;
    this.shutdown = shutdown;
    this.modelSettings = modelSettings;
    this.customLanguage = customLanguage;
    this.guestSettings = guestSettings;
    this.session = session;
    this._id = v4();
    this.mode = mode || AUTOMATIC_MODE;
    this.playbackControl =
      playbackControl || this.mode == PAUSE_MODE ? AGENT_PAUSE : AGENT_PLAY;
    this.currentTask = undefined;
    this.sessionToken = getSessionToken();
  }

  async run() {
    if (!this.isRunning) {
      this.isRunning = true;
      await this.startGoal();
    }

    await this.loop();
    if (this.mode === PAUSE_MODE && !this.isRunning) {
      this.handlePause({ agentPlaybackControl: this.playbackControl });
    }
  }

  async startGoal() {
    const { isGuestMode, isValidGuest } = this.guestSettings;
    if (isGuestMode && !isValidGuest && !this.hasValidApiKey()) {
      this.sendErrorMessage(
        `${i18n?.t("errors.invalid-guest-key", { ns: "chat" })}`
      );
      this.stopAgent();
      return;
    }

    this.sendGoalMessage();
    this.sendThinkingMessage();

    try {
      const taskValues = await this.getInitialTasks();

      // Enhanced validation - ensure we have a valid array
      if (!taskValues || !Array.isArray(taskValues) || taskValues.length === 0) {
        this.sendErrorMessage(
          "No initial tasks could be created. Please make your goal more specific or try a different approach."
        );
        this.stopAgent();
        return;
      }

      // Safely iterate with validation
      for (const value of taskValues) {
        if (value && typeof value === 'string' && value.trim()) {
          await new Promise((r) => setTimeout(r, TIMOUT_SHORT));
          const task: Task = {
            taskId: v1().toString(),
            value: value.trim(),
            status: TASK_STATUS_STARTED,
            type: MESSAGE_TYPE_TASK,
          };
          this.sendMessage(task);
        }
      }
    } catch (e) {
      console.log("Error in startGoal:", e);
      this.sendErrorMessage(this.getMessageFromError(e));
      this.shutdown();
      return;
    }
  }

  async loop() {
    this.conditionalPause();

    if (!this.isRunning) {
      return;
    }

    const remainingTasks = this.getRemainingTasks();
    if (!remainingTasks || remainingTasks.length === 0) {
      this.sendCompletedMessage();
      this.shutdown();
      return;
    }

    this.numLoops += 1;
    const maxLoops = this.maxLoops();
    if (this.numLoops > maxLoops) {
      this.sendLoopMessage();
      this.shutdown();
      return;
    }

    await new Promise((r) => setTimeout(r, TIMEOUT_LONG));

    const currentTask = remainingTasks[0] as Task;
    if (!currentTask || !currentTask.value) {
      console.warn("Invalid task found, skipping");
      await this.loop();
      return;
    }

    this.sendMessage({ ...currentTask, status: TASK_STATUS_EXECUTING });
    this.currentTask = currentTask;
    this.sendThinkingMessage(currentTask.taskId);

    let analysis: Analysis = { action: "reason", arg: "" };

    try {
      if (useAgentStore.getState().isWebSearchEnabled) {
        analysis = await this.analyzeTask(currentTask.value);
        this.sendAnalysisMessage(analysis, currentTask.taskId);
      }

      const result = await this.executeTask(currentTask.value, analysis);
      this.sendMessage({
        ...currentTask,
        info: result,
        status: TASK_STATUS_COMPLETED,
      });

      this.completedTasks.push(currentTask.value || "");

      await new Promise((r) => setTimeout(r, TIMEOUT_LONG));
      this.sendThinkingMessage(currentTask.taskId);

      try {
        const additionalTaskValues = await this.getAdditionalTasks(currentTask.value, result);

        // Ensure we have a valid array for iteration
        const validTaskValues = Array.isArray(additionalTaskValues)
          ? additionalTaskValues.filter(value => value && typeof value === 'string' && value.trim())
          : [];

        const newTasks: Task[] = validTaskValues.map((value) => ({
          taskId: v1().toString(),
          value: value.trim(),
          status: TASK_STATUS_STARTED,
          type: MESSAGE_TYPE_TASK,
          parentTaskId: currentTask.taskId,
        }));

        // Safely iterate over new tasks
        for (const task of newTasks) {
          if (task && task.value) {
            await new Promise((r) => setTimeout(r, TIMOUT_SHORT));
            this.sendMessage(task);
          }
        }

        if (newTasks.length === 0) {
          this.sendMessage({ ...currentTask, status: TASK_STATUS_FINAL });
        }
      } catch (e) {
        console.log("Error creating additional tasks:", e);
        this.sendErrorMessage(
          `${i18n?.t("errors.adding-additional-task", { ns: "chat" })}`
        );
        this.sendMessage({ ...currentTask, status: TASK_STATUS_FINAL });
      }

      await this.loop();
    } catch (e) {
      console.log("Error in task execution loop:", e);
      this.sendErrorMessage(
        `Task execution failed: ${this.getMessageFromError(e)}`
      );
      this.sendMessage({ ...currentTask, status: TASK_STATUS_FINAL });
      await this.loop();
    }
  }

  getRemainingTasks() {
    try {
      const tasks = useMessageStore.getState().tasks;
      if (!Array.isArray(tasks)) {
        console.warn("Tasks is not an array, returning empty array");
        return [];
      }
      return tasks.filter((task: Task) =>
        task &&
        task.status === TASK_STATUS_STARTED &&
        task.value &&
        typeof task.value === 'string'
      );
    } catch (error) {
      console.error("Error getting remaining tasks:", error);
      return [];
    }
  }

  private conditionalPause() {
    if (this.mode != PAUSE_MODE) {
      return;
    }

    this.isRunning = !(this.playbackControl === AGENT_PAUSE);

    if (this.playbackControl === AGENT_PLAY) {
      this.playbackControl = AGENT_PAUSE;
    }
  }

  private maxLoops() {
    const defaultLoops = !!this.session?.user.subscriptionId
      ? DEFAULT_MAX_LOOPS_PAID
      : DEFAULT_MAX_LOOPS_FREE;

    return this.hasValidApiKey()
      ? this.modelSettings.customMaxLoops || DEFAULT_MAX_LOOPS_CUSTOM_API_KEY
      : defaultLoops;
  }

  private hasValidApiKey(): boolean {
    const provider = this.modelSettings.llmProvider || "groq";

    switch (provider) {
      case "groq":
        return !!(this.modelSettings.groqApiKey || this.modelSettings.customApiKey);
      case "openrouter":
        return !!(this.modelSettings.openrouterApiKey || this.modelSettings.customApiKey);
      case "cohere":
        return !!(this.modelSettings.cohereApiKey || this.modelSettings.customApiKey);
      default:
        return !!this.modelSettings.customApiKey;
    }
  }

  async getInitialTasks(): Promise<string[]> {
    try {
      if (this.shouldRunClientSide()) {
        return await AgentService.startGoalAgent(
          this.modelSettings,
          this.goal,
          this.customLanguage,
          this.sessionToken
        );
      }

      const data = {
        modelSettings: this.modelSettings,
        goal: this.goal,
        customLanguage: this.customLanguage,
        sessionToken: this.sessionToken,
      };

      if (this.shouldUseStreaming()) {
        const result = await this.handleStreamingRequest("/api/agent/start", data);
        // Ensure we extract the correct data structure
        if (result && Array.isArray(result.newTasks)) {
          return result.newTasks;
        }
        if (result && Array.isArray(result)) {
          return result;
        }
        throw new Error("Invalid response format from streaming API");
      }

      const res = await this.post(`/api/agent/start`, data);
      const tasks = res.data.newTasks || res.data;

      if (!Array.isArray(tasks)) {
        throw new Error("API did not return a valid array of tasks");
      }

      return tasks;
    } catch (error) {
      console.error("Failed to get initial tasks:", error);
      return this.generateEmergencyFallbackTasks();
    }
  }

  private generateEmergencyFallbackTasks(): string[] {
    const goalLower = this.goal.toLowerCase();

    if (goalLower.includes("write") || goalLower.includes("create")) {
      return [
        `Plan the structure for: ${this.goal}`,
        `Research relevant information`,
        `Create a detailed outline`,
        `Begin implementation`
      ];
    }

    if (goalLower.includes("learn") || goalLower.includes("study")) {
      return [
        `Identify learning objectives for: ${this.goal}`,
        `Find reliable learning resources`,
        `Create a study plan`,
        `Begin studying fundamentals`
      ];
    }

    return [
      `Analyze the requirements for: ${this.goal}`,
      `Research relevant information and context`,
      `Develop a step-by-step approach`,
      `Begin executing the plan`
    ];
  }

  async getAdditionalTasks(
    currentTask: string,
    result: string
  ): Promise<string[]> {
    try {
      const taskValues = this.getRemainingTasks().map((task) => task.value).filter(Boolean);

      if (this.shouldRunClientSide()) {
        return await AgentService.createTasksAgent(
          this.modelSettings,
          this.goal,
          taskValues,
          currentTask,
          result,
          this.completedTasks,
          this.customLanguage,
          this.sessionToken
        );
      }

      const data = {
        modelSettings: this.modelSettings,
        goal: this.goal,
        tasks: taskValues,
        lastTask: currentTask,
        result: result,
        completedTasks: this.completedTasks,
        customLanguage: this.customLanguage,
        sessionToken: this.sessionToken,
      };

      if (this.shouldUseStreaming()) {
        const result = await this.handleStreamingRequest("/api/agent/create", data);
        if (result && Array.isArray(result.newTasks)) {
          return result.newTasks;
        }
        if (result && Array.isArray(result)) {
          return result;
        }
        return [];
      }

      const res = await this.post(`/api/agent/create`, data);
      const tasks = res.data.newTasks || res.data || [];

      return Array.isArray(tasks) ? tasks : [];
    } catch (error) {
      console.error("Failed to get additional tasks:", error);
      return []; // Always return empty array on failure
    }
  }

  async analyzeTask(task: string): Promise<Analysis> {
    try {
      if (this.shouldRunClientSide()) {
        return await AgentService.analyzeTaskAgent(
          this.modelSettings,
          this.goal,
          task,
          this.sessionToken
        );
      }

      const data = {
        modelSettings: this.modelSettings,
        goal: this.goal,
        task: task,
        customLanguage: this.customLanguage,
        sessionToken: this.sessionToken,
      };

      if (this.shouldUseStreaming()) {
        const result = await this.handleStreamingRequest("/api/agent/analyze", data);
        return (result && result.response) || { action: "reason", arg: "Analysis via reasoning" };
      }

      const res = await this.post("/api/agent/analyze", data);
      return res.data.response as Analysis;
    } catch (error) {
      console.error("Failed to analyze task:", error);

      const taskLower = task.toLowerCase();
      const currentInfoKeywords = ['current', 'latest', 'recent', 'today', 'now', 'update', 'news'];

      if (currentInfoKeywords.some(keyword => taskLower.includes(keyword))) {
        return { action: "search", arg: task.substring(0, 50) };
      }

      return { action: "reason", arg: "Analyze using existing knowledge" };
    }
  }

  async executeTask(task: string, analysis: Analysis): Promise<string> {
    try {
      if (this.shouldRunClientSide() && analysis.action !== "search") {
        return await AgentService.executeTaskAgent(
          this.modelSettings,
          this.goal,
          task,
          analysis,
          this.customLanguage,
          this.sessionToken
        );
      }

      const data = {
        modelSettings: this.modelSettings,
        goal: this.goal,
        task: task,
        analysis: analysis,
        customLanguage: this.customLanguage,
        sessionToken: this.sessionToken,
      };

      if (this.shouldUseStreaming()) {
        const result = await this.handleStreamingRequest("/api/agent/execute", data);
        return (result && result.response) || `Completed task: ${task}`;
      }

      const res = await this.post("/api/agent/execute", data);
      return res.data.response as string;
    } catch (error) {
      console.error("Failed to execute task:", error);
      return this.generateFallbackTaskResponse(task);
    }
  }

  private generateFallbackTaskResponse(task: string): string {
    const taskLower = task.toLowerCase();

    if (taskLower.includes("research") || taskLower.includes("find")) {
      return `For "${task}": Start with reliable sources, cross-reference information, take detailed notes, and organize findings logically.`;
    }

    if (taskLower.includes("create") || taskLower.includes("write")) {
      return `For "${task}": Define requirements, research examples, create an outline, develop iteratively, and review carefully.`;
    }

    if (taskLower.includes("analyze") || taskLower.includes("evaluate")) {
      return `For "${task}": Break into components, examine systematically, identify patterns, consider multiple perspectives, draw evidence-based conclusions.`;
    }

    return `Task "${task}" has been processed. Next steps would involve gathering requirements, planning approach, executing systematically, and validating results.`;
  }

  private async handleStreamingRequest(url: string, data: RequestBody): Promise<any> {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      let result: any = null;
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                return result;
              }

              try {
                const parsed = JSON.parse(data);

                if (parsed.type === 'status') {
                  console.log('Status:', parsed.message);
                } else if (parsed.type === 'content') {
                  console.log('Content:', parsed.content);
                } else if (parsed.type === 'complete') {
                  result = parsed.result;
                } else if (parsed.type === 'error') {
                  throw new Error(parsed.error);
                }
              } catch (parseError) {
                // Ignore parse errors for non-JSON lines
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      return result;
    } catch (error) {
      console.error('Streaming request failed:', error);
      throw error;
    }
  }

  private async post(url: string, data: RequestBody) {
    try {
      return await axios.post(url, data);
    } catch (e) {
      this.shutdown();

      if (axios.isAxiosError(e) && e.response?.status === 429) {
        this.sendErrorMessage(
          `${i18n?.t("errors.rate-limit", { ns: "chat" })}`
        );
      }

      throw e;
    }
  }

  private shouldRunClientSide() {
    return this.hasValidApiKey();
  }

  private shouldUseStreaming() {
    return !this.shouldRunClientSide();
  }

  updatePlayBackControl(newPlaybackControl: AgentPlaybackControl) {
    this.playbackControl = newPlaybackControl;
  }

  updateIsRunning(isRunning: boolean) {
    this.isRunning = isRunning;
  }

  stopAgent() {
    this.sendManualShutdownMessage();
    this.isRunning = false;
    this.shutdown();
    return;
  }

  sendMessage(message: Message) {
    if (this.isRunning) {
      this.renderMessage(message);
    }
  }

  sendGoalMessage(taskId?: string) {
    this.sendMessage({
      type: MESSAGE_TYPE_GOAL,
      value: this.goal,
      taskId,
    });
  }

  sendLoopMessage() {
    let value = "";
    if (this.hasValidApiKey() || this.guestSettings.isGuestMode) {
      value = `${i18n?.t("loop-with-filled-customApiKey", { ns: "chat" })}`;
    } else {
      value = `${i18n?.t("loop-with-empty-customApiKey", { ns: "chat" })}`;
    }

    this.sendMessage({
      type: MESSAGE_TYPE_SYSTEM,
      value,
      taskId: this.currentTask?.taskId,
    });
  }

  sendManualShutdownMessage() {
    this.sendMessage({
      type: MESSAGE_TYPE_SYSTEM,
      value: `${i18n?.t("manually-shutdown", { ns: "chat" })}`,
      taskId: this.currentTask?.taskId,
    });
  }

  sendCompletedMessage() {
    this.sendMessage({
      type: MESSAGE_TYPE_SYSTEM,
      value: `${i18n?.t("all-tasks-completed", { ns: "chat" })}`,
      taskId: this.currentTask?.taskId,
    });
  }

  sendAnalysisMessage(analysis: Analysis, taskId?: string) {
    let message = `${i18n?.t("generating-response", { ns: "chat" })}`;
    if (analysis.action == "search") {
      message = `${i18n?.t("searching-web-for", {
        ns: "chat",
        arg: analysis.arg,
      })}`;
    }

    this.sendMessage({
      type: MESSAGE_TYPE_SYSTEM,
      value: message,
      taskId,
    });
  }

  sendThinkingMessage(taskId?: string) {
    this.sendMessage({
      type: MESSAGE_TYPE_THINKING,
      value: "",
      taskId: taskId,
    });
  }

  sendErrorMessage(error: string) {
    this.sendMessage({
      type: MESSAGE_TYPE_SYSTEM,
      value: error,
      taskId: this.currentTask?.taskId,
    });
  }

  private getMessageFromError(e: unknown): string {
    let message = `${i18n?.t("errors.accessing-apis", { ns: "chat" })}`;

    if (axios.isAxiosError(e)) {
      const axiosError = e;
      const status = axiosError.response?.status;
      if (status === 429) {
        message = `${i18n?.t("errors.rate-limit", { ns: "chat" })}`;
      } else if (status === 404) {
        message = `${i18n?.t("errors.accessing-gtp4", { ns: "chat" })}`;
      } else if (status === 401) {
        message = "API authentication failed. Please check your API keys in settings.";
      } else if (status !== undefined && status >= 500) {
        message = "Server error occurred. Please try again in a moment.";
      }
    } else if (e instanceof Error) {
      if (e.message.includes("Demo token limit")) {
        message = "Demo token limit reached. Please use your own API key or wait for token reset.";
      } else if (e.message.includes("Insufficient")) {
        message = "Insufficient tokens remaining. Please wait for reset or use your own API key.";
      } else if (e.message.includes("network") || e.message.includes("fetch")) {
        message = "Network error. Please check your connection and try again.";
      } else {
        message = `Error: ${e.message}`;
      }
    } else {
      message = `${i18n?.t("errors.initial-tasks", { ns: "chat" })}`;
    }

    return message;
  }
}

export default AutonomousAgent;