// src/pages/index.tsx

import React, { useEffect, useRef, useState, useCallback } from "react";
import { type NextPage, type GetStaticProps } from "next";
import DefaultLayout from "../layout/default";
import ChatWindow from "../components/ChatWindow";
import Drawer from "../components/Drawer";
import Input from "../components/Input";
import Button from "../components/Button";
import { FaRobot, FaStar, FaPlay, FaCoins, FaInfoCircle } from "react-icons/fa";
import { VscLoading } from "react-icons/vsc";
import AutonomousAgent from "../components/AutonomousAgent";
import Expand from "../components/motions/expand";
import HelpDialog from "../components/HelpDialog";
import { SettingsDialog } from "../components/SettingsDialog";
import { TaskWindow } from "../components/TaskWindow";
import { TokenDepletionDialog } from "../components/TokenDepletionDialog";
import { useAuth } from "../hooks/useAuth";
import type { AgentPlaybackControl, Message } from "../types/agentTypes";
import { useAgent } from "../hooks/useAgent";
import { isEmptyOrBlank } from "../utils/whitespace";
import {
  useMessageStore,
  useAgentStore,
  resetAllMessageSlices,
} from "../components/stores";
import { isTask, AGENT_PLAY } from "../types/agentTypes";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { useSettings } from "../hooks/useSettings";
import { SorryDialog } from "../components/SorryDialog";
import { SignInDialog } from "../components/SignInDialog";
import WeChatPayDialog from "../components/WeChatPayDialog";
import QQDialog from "../components/QQDialog";
import { useTranslation } from "next-i18next";
import { useRouter } from "next/router";
import { useGuestMode } from "../hooks/useGuestMode";
import { authEnabled } from "../utils/env-helper";
import { LLM_PROVIDERS, PROVIDER_NAMES, DEMO_TOKEN_LIMIT, DEFAULT_MODELS } from "../utils/constants";
import type { LLMProvider } from "../utils/types";
import TokenBalance from "../components/TokenBalance";
import { getValidModelForProvider } from "../utils/modelValidation";
import {
  saveQueryResponse,
  createSession,
  initializeDatabase,
  getSessionToken,
  getCookieId,
  getTokenStatus
} from "../utils/database";

const Home: NextPage = () => {
  const { t, i18n } = useTranslation();
  const addMessage = useMessageStore.use.addMessage();
  const messages = useMessageStore.use.messages();
  const tasks = useMessageStore.use.tasks();
  const updateTaskStatus = useMessageStore.use.updateTaskStatus();

  const setAgent = useAgentStore.use.setAgent();
  const isAgentStopped = useAgentStore.use.isAgentStopped();
  const isAgentPaused = useAgentStore.use.isAgentPaused();
  const updateIsAgentPaused = useAgentStore.use.updateIsAgentPaused();
  const updateIsAgentStopped = useAgentStore.use.updateIsAgentStopped();
  const agentMode = useAgentStore.use.agentMode();
  const agent = useAgentStore.use.agent();

  const { session, status } = useAuth();
  const [name, setName] = useState<string>("");
  const [goalInput, setGoalInput] = useState<string>("");
  const [showHelpDialog, setShowHelpDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showSorryDialog, setShowSorryDialog] = React.useState(false);
  const [showSignInDialog, setShowSignInDialog] = React.useState(false);
  const [showTokenDepletionDialog, setShowTokenDepletionDialog] = React.useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [showWeChatPayDialog, setShowWeChatPayDialog] = useState(false);
  const [showQQDialog, setShowQQDialog] = useState(false);
  const [customLanguage, setCustomLanguage] = useState<string>(i18n.language);
  const [sessionToken, setSessionToken] = useState<string>("");
  const [tokenStatus, setTokenStatus] = useState<any>(null);
  const [isFirstVisit, setIsFirstVisit] = useState(false);

  const settingsModel = useSettings();
  const { isValidGuest, isGuestMode } = useGuestMode(
    settingsModel.settings.customGuestKey
  );

  const router = useRouter();
  const agentUtils = useAgent();

  // Initialize database and session
  useEffect(() => {
    const initializeSession = async () => {
      try {
        await initializeDatabase();

        const token = getSessionToken();
        const cookieId = getCookieId();

        setSessionToken(token);
        await createSession(token, cookieId);

        // Get initial token status
        const status = await getTokenStatus(token);
        setTokenStatus(status);
      } catch (error) {
        console.error('Failed to initialize session:', error);
      }
    };

    initializeSession();
  }, []);

  // Refresh token status periodically
  useEffect(() => {
    if (!sessionToken) return;

    const refreshTokenStatus = async () => {
      try {
        const status = await getTokenStatus(sessionToken);
        setTokenStatus(status);
      } catch (error) {
        console.error('Failed to refresh token status:', error);
      }
    };

    // Refresh every 10 seconds
    const interval = setInterval(refreshTokenStatus, 10000);
    return () => clearInterval(interval);
  }, [sessionToken]);

  // Check if first visit and show enhanced help
  useEffect(() => {
    const key = "agentgpt-modal-opened-new";
    const savedModalData = localStorage.getItem(key);
    const hasVisited = localStorage.getItem("autogpt-has-visited");

    setTimeout(() => {
      if (savedModalData == null || !hasVisited) {
        setIsFirstVisit(true);
        setShowHelpDialog(true);
      }
    }, 1800);

    localStorage.setItem(key, JSON.stringify(true));
  }, []);

  // Debug effect to monitor provider/model changes
  useEffect(() => {
    console.log("Settings updated:", {
      llmProvider: settingsModel.settings.llmProvider,
      customModelName: settingsModel.settings.customModelName,
      timestamp: new Date().toISOString()
    });
  }, [settingsModel.settings.llmProvider, settingsModel.settings.customModelName]);

  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameInputRef?.current?.focus();
  }, []);

  useEffect(() => {
    updateIsAgentStopped();
  }, [agent, updateIsAgentStopped]);

  const handleAddMessage = useCallback((newMessage: Message) => {
    if (isTask(newMessage)) {
      updateTaskStatus(newMessage);
    }

    addMessage(newMessage);

    // Save to database
    if (sessionToken && newMessage.value) {
      const query = newMessage.type === "goal" ? `Goal: ${newMessage.value}` : newMessage.value;
      const response = newMessage.info || newMessage.value;

      saveQueryResponse(sessionToken, query, response, {
        type: newMessage.type,
        taskId: newMessage.taskId,
        parentTaskId: newMessage.parentTaskId,
        llmProvider: settingsModel.settings.llmProvider,
      }).catch(console.error);
    }
  }, [addMessage, updateTaskStatus, sessionToken, settingsModel.settings.llmProvider]);

  const handlePause = (opts: {
    agentPlaybackControl?: AgentPlaybackControl;
  }) => {
    if (opts.agentPlaybackControl !== undefined) {
      updateIsAgentPaused(opts.agentPlaybackControl);
    }
  };

  const handleTokensExhausted = useCallback(() => {
    setShowTokenDepletionDialog(true);
    agent?.stopAgent();
  }, [agent]);

  // Fixed deploy agent logic with better token handling
  const disableDeployAgent = React.useMemo(() => {
    // Basic validation
    if (agent != null || isEmptyOrBlank(name) || isEmptyOrBlank(goalInput)) {
      return true;
    }

    // If we don't have token status yet, allow deployment (optimistic)
    if (!tokenStatus) {
      return false;
    }

    // Check if user has demo tokens available
    const hasTokens = tokenStatus.tokensRemaining > 0;

    // If we have tokens OR valid configuration, allow deployment
    return !hasTokens && !settingsModel.isConfigurationValid();
  }, [agent, name, goalInput, tokenStatus, settingsModel]);

  const handleNewGoal = () => {
    if (
      session === null &&
      process.env.NODE_ENV === "production" &&
      authEnabled
    ) {
      setShowSignInDialog(true);
      return;
    }

    // Check token availability first
    if (tokenStatus && !tokenStatus.canUseTokens) {
      setShowTokenDepletionDialog(true);
      return;
    }

    // If no tokens and no valid config, show settings
    if (!tokenStatus?.canUseTokens && !settingsModel.isConfigurationValid()) {
      setShowSettingsDialog(true);
      return;
    }

    const agent = new AutonomousAgent(
      name.trim(),
      goalInput.trim(),
      handleAddMessage,
      handlePause,
      () => setAgent(null),
      settingsModel.settings,
      agentMode,
      customLanguage,
      { isValidGuest, isGuestMode },
      session ?? undefined
    );
    setAgent(agent);
    setHasSaved(false);
    resetAllMessageSlices();
    agent.run().then(console.log).catch(console.error);
  };

  const handleContinue = () => {
    if (!agent) {
      return;
    }

    agent.updatePlayBackControl(AGENT_PLAY);
    updateIsAgentPaused(agent.playbackControl);
    agent.updateIsRunning(true);
    agent.run().then(console.log).catch(console.error);
  };

  const handleKeyPress = (
    e:
      | React.KeyboardEvent<HTMLInputElement>
      | React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (e.ctrlKey && e.key === "Enter" && !disableDeployAgent) {
      if (isAgentPaused) {
        handleContinue();
      }
      handleNewGoal();
    }
  };

  const handleStopAgent = () => {
    agent?.stopAgent();
    updateIsAgentStopped();
  };

  const handleLanguageChange = () => {
    const { pathname, asPath, query, locale } = router;
    const lng = locale === "en" ? "zh" : "en";
    router.push({ pathname, query }, asPath, {
      locale: lng,
    });
    setCustomLanguage(lng);
  };

  // Provider change handler - properly integrated with settings
  const handleProviderChange = useCallback((provider: LLMProvider) => {
    console.log("Home: Changing provider to:", provider);
    settingsModel.updateProvider(provider);
  }, [settingsModel]);

  // Model change handler - properly integrated with settings
  const handleModelChange = useCallback((model: string) => {
    console.log("Home: Changing model to:", model);
    settingsModel.updateModel(model);
  }, [settingsModel]);

  // Get current provider from settings
  const getCurrentProvider = (): LLMProvider => {
    const provider = settingsModel.settings.llmProvider || LLM_PROVIDERS.GROQ;
    console.log("Current provider from settings:", provider);
    return provider;
  };

  // Get current model from settings with validation
  const getCurrentModel = (): string => {
    const provider = getCurrentProvider();
    const modelFromSettings = settingsModel.settings.customModelName;
    const validModel = getValidModelForProvider(modelFromSettings, provider);

    console.log("Current model calculation:", {
      provider,
      modelFromSettings,
      validModel,
      defaultForProvider: DEFAULT_MODELS[provider]
    });

    return validModel;
  };

  const proTitle = (
    <>
      AutoGPT Next Web<span className="ml-1 text-amber-500/90">Pro</span>
    </>
  );

  const shouldShowSave =
    status === "authenticated" &&
    isAgentStopped &&
    messages.length &&
    !hasSaved;

  const showDonation =
    authEnabled && status !== "loading" && !session?.user.subscriptionId;

  const firstButton =
    isAgentPaused && !isAgentStopped ? (
      <Button ping disabled={!isAgentPaused} onClick={handleContinue}>
        <FaPlay size={20} />
        <span className="ml-2">{t("continue")}</span>
      </Button>
    ) : (
      <Button disabled={disableDeployAgent} onClick={handleNewGoal}>
        {agent == null ? (
          t("deploy-agent")
        ) : (
          <>
            <VscLoading className="animate-spin" size={20} />
            <span className="ml-2">{t("running")}</span>
          </>
        )}
      </Button>
    );

  const currentProvider = getCurrentProvider();
  const currentModel = getCurrentModel();
  const hasValidConfig = settingsModel.isConfigurationValid();

  console.log("Home render state:", {
    currentProvider,
    currentModel,
    hasValidConfig,
    settingsLlmProvider: settingsModel.settings.llmProvider,
    settingsModelName: settingsModel.settings.customModelName
  });

  return (
    <DefaultLayout>
      <HelpDialog
        show={showHelpDialog}
        close={() => setShowHelpDialog(false)}
        sessionToken={sessionToken}
      />
      <SettingsDialog
        customSettings={settingsModel}
        show={showSettingsDialog}
        close={() => setShowSettingsDialog(false)}
      />
      <SorryDialog
        show={showSorryDialog}
        close={() => setShowSorryDialog(false)}
      />
      <SignInDialog
        show={showSignInDialog}
        close={() => setShowSignInDialog(false)}
      />
      <TokenDepletionDialog
        show={showTokenDepletionDialog}
        close={() => setShowTokenDepletionDialog(false)}
        resetTime={tokenStatus?.resetAt}
      />
      <WeChatPayDialog
        show={showWeChatPayDialog}
        close={() => setShowWeChatPayDialog(false)}
      />
      <QQDialog show={showQQDialog} close={() => setShowQQDialog(false)} />

      <main className="flex min-h-screen flex-row">
        <Drawer
          showHelp={() => setShowHelpDialog(true)}
          showSettings={() => setShowSettingsDialog(true)}
          showQQ={() => setShowQQDialog(true)}
          showWeChatPay={() => setShowWeChatPayDialog(true)}
          handleLanguageChange={handleLanguageChange}
          showDonation={showDonation}
        />
        <div
          id="content"
          className="z-10 flex min-h-screen w-full items-center justify-center p-2 px-2 sm:px-4 md:px-10"
        >
          <div
            id="layout"
            className="flex h-full w-full max-w-full flex-col items-center justify-between gap-3 md:justify-center"
          >
            <div
              id="title"
              className="relative flex flex-col items-center font-mono"
            >
              <div className="flex flex-row items-start shadow-2xl">
                <span className="text-4xl font-bold text-[#C0C0C0] xs:text-5xl sm:text-6xl">
                  Auto
                </span>
                <span className="text-4xl font-bold text-white xs:text-5xl sm:text-6xl">
                  GPT.
                </span>
                <span className="text-4xl font-bold text-white xs:text-5xl sm:text-6xl">
                  NextWeb
                </span>
              </div>
              <div className="mt-1 text-center font-mono text-[0.7em] font-bold text-white">
                <p>{t("sub-title")}</p>
                <div className="flex items-center justify-center gap-3 mt-1">
                  <p className="text-xs text-blue-400">
                    {t("powered-by")} {PROVIDER_NAMES[currentProvider]}
                    {!hasValidConfig && !tokenStatus?.canUseTokens && (
                      <span className="text-red-400 ml-2">
                        ({t("configuration-required")})
                      </span>
                    )}
                    {tokenStatus?.canUseTokens && (
                      <span className="text-green-400 ml-2">
                        (Demo Mode)
                      </span>
                    )}
                  </p>

                  {/* Inline Token Counter */}
                  {sessionToken && (
                    <div className="flex items-center gap-2 bg-yellow-900/30 px-3 py-1 rounded-full border border-yellow-500/50">
                      <FaCoins className="text-yellow-400 text-sm" />
                      <TokenBalance
                        sessionToken={sessionToken}
                        onTokensExhausted={handleTokensExhausted}
                        compact={true}
                        showDetails={false}
                        className="text-xs"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <Expand className="flex w-full flex-row">
              <ChatWindow
                className="sm:mt-4"
                messages={messages}
                title={session?.user.subscriptionId ? proTitle : "AutoGPT"}
                onSave={
                  shouldShowSave
                    ? (format) => {
                        setHasSaved(true);
                        agentUtils.saveAgent({
                          goal: goalInput.trim(),
                          name: name.trim(),
                          tasks: messages,
                        });
                      }
                    : undefined
                }
                scrollToBottom
                displaySettings
                openSorryDialog={() => setShowSorryDialog(true)}
                llmProvider={currentProvider}
                onProviderChange={handleProviderChange}
                onModelChange={handleModelChange}
                currentModel={currentModel}
                sessionToken={sessionToken}
                onTokensExhausted={handleTokensExhausted}
              />
              {(agent || tasks.length > 0) && <TaskWindow />}
            </Expand>

            <div className="flex w-full flex-col gap-2 sm:mt-4 md:mt-10">
              <Expand delay={1.2}>
                <Input
                  inputRef={nameInputRef}
                  left={
                    <>
                      <FaRobot />
                      <span className="ml-2">{t("agent-name")}</span>
                    </>
                  }
                  value={name}
                  disabled={agent != null}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => handleKeyPress(e)}
                  placeholder="AutoGPT"
                  type="text"
                />
              </Expand>
              <Expand delay={1.3}>
                <Input
                  left={
                    <>
                      <FaStar />
                      <span className="ml-2">{t("goal")}</span>
                    </>
                  }
                  disabled={agent != null}
                  value={goalInput}
                  onChange={(e) => setGoalInput(e.target.value)}
                  onKeyDown={(e) => handleKeyPress(e)}
                  placeholder={t("placeholder-agent-goal") as string}
                  type="textarea"
                />
              </Expand>
            </div>

            <Expand delay={1.4} className="flex gap-2">
              {firstButton}
              <Button
                disabled={agent === null}
                onClick={handleStopAgent}
                enabledClassName={"bg-red-600 hover:bg-red-400"}
              >
                {!isAgentStopped && agent === null ? (
                  <>
                    <VscLoading className="animate-spin" size={20} />
                    <span className="ml-2">{t("stopping")}</span>
                  </>
                ) : (
                  t("stop-agent")
                )}
              </Button>
              <Button
                onClick={() => setShowSettingsDialog(true)}
                enabledClassName={"bg-gray-600 hover:bg-gray-500"}
              >
                {t("settings")}
              </Button>
            </Expand>
          </div>
        </div>
      </main>
    </DefaultLayout>
  );
};

export default Home;

export const getStaticProps: GetStaticProps = async ({ locale }) => ({
  props: {
    ...(await serverSideTranslations(locale ?? "zh", [
      "common",
      "help",
      "settings",
      "chat",
    ])),
  },
});