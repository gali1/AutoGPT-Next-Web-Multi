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
      for (const value of taskValues) {
        await new Promise((r) => setTimeout(r, TIMOUT_SHORT));
        const task: Task = {
          taskId: v1().toString(),
          value,
          status: TASK_STATUS_STARTED,
          type: MESSAGE_TYPE_TASK,
        };
        this.sendMessage(task);
      }
    } catch (e) {
      console.log(e);
      this.sendErrorMessage(getMessageFromError(e));
      this.shutdown();
      return;
    }
  }

  async loop() {
    this.conditionalPause();

    if (!this.isRunning) {
      return;
    }

    if (this.getRemainingTasks().length === 0) {
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

    const currentTask = this.getRemainingTasks()[0] as Task;
    this.sendMessage({ ...currentTask, status: TASK_STATUS_EXECUTING });

    this.currentTask = currentTask;

    this.sendThinkingMessage(currentTask.taskId);

    let analysis: Analysis = { action: "reason", arg: "" };

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
      const newTasks: Task[] = (
        await this.getAdditionalTasks(currentTask.value, result)
      ).map((value) => {
        const task: Task = {
          taskId: v1().toString(),
          value,
          status: TASK_STATUS_STARTED,
          type: MESSAGE_TYPE_TASK,
          parentTaskId: currentTask.taskId,
        };
        return task;
      });

      for (const task of newTasks) {
        await new Promise((r) => setTimeout(r, TIMOUT_SHORT));
        this.sendMessage(task);
      }

      if (newTasks.length == 0) {
        this.sendMessage({ ...currentTask, status: TASK_STATUS_FINAL });
      }
    } catch (e) {
      console.log(e);
      this.sendErrorMessage(
        `${i18n?.t("errors.adding-additional-task", { ns: "chat" })}`
      );
      this.sendMessage({ ...currentTask, status: TASK_STATUS_FINAL });
    }

    await this.loop();
  }

  getRemainingTasks() {
    const tasks = useMessageStore.getState().tasks;
    return tasks.filter((task: Task) => task.status === TASK_STATUS_STARTED);
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
    if (this.shouldRunClientSide()) {
      return await AgentService.startGoalAgent(
        this.modelSettings,
        this.goal,
        this.customLanguage
      );
    }

    const data = {
      modelSettings: this.modelSettings,
      goal: this.goal,
      customLanguage: this.customLanguage,
      sessionToken: this.sessionToken,
    };

    if (this.shouldUseStreaming()) {
      return await this.handleStreamingRequest("/api/agent/start", data);
    }

    const res = await this.post(`/api/agent/start`, data);
    return res.data.newTasks as string[];
  }

  async getAdditionalTasks(
    currentTask: string,
    result: string
  ): Promise<string[]> {
    const taskValues = this.getRemainingTasks().map((task) => task.value);

    if (this.shouldRunClientSide()) {
      return await AgentService.createTasksAgent(
        this.modelSettings,
        this.goal,
        taskValues,
        currentTask,
        result,
        this.completedTasks,
        this.customLanguage
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
      return await this.handleStreamingRequest("/api/agent/create", data);
    }

    const res = await this.post(`/api/agent/create`, data);
    return res.data.newTasks as string[];
  }

  async analyzeTask(task: string): Promise<Analysis> {
    if (this.shouldRunClientSide()) {
      return await AgentService.analyzeTaskAgent(
        this.modelSettings,
        this.goal,
        task
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
      return result as Analysis;
    }

    const res = await this.post("/api/agent/analyze", data);
    return res.data.response as Analysis;
  }

  async executeTask(task: string, analysis: Analysis): Promise<string> {
    if (this.shouldRunClientSide() && analysis.action !== "search") {
      return await AgentService.executeTaskAgent(
        this.modelSettings,
        this.goal,
        task,
        analysis,
        this.customLanguage
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
      return await this.handleStreamingRequest("/api/agent/execute", data);
    }

    const res = await this.post("/api/agent/execute", data);
    return res.data.response as string;
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
}

const getMessageFromError = (e: unknown) => {
  let message = `${i18n?.t("errors.accessing-apis", { ns: "chat" })}`;

  if (axios.isAxiosError(e)) {
    const axiosError = e;
    if (axiosError.response?.status === 429) {
      message = `${i18n?.t("errors.accessing-using-apis", { ns: "chat" })}`;
    }
    if (axiosError.response?.status === 404) {
      message = `${i18n?.t("errors.accessing-gtp4", { ns: "chat" })}`;
    }
  } else {
    message = `${i18n?.t("errors.initial-tasks", { ns: "chat" })}`;
  }
  return message;
};

export default AutonomousAgent;