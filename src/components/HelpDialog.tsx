// src/components/HelpDialog.tsx

import React, { useState, useEffect } from "react";
import { FaDiscord, FaGithub, FaCoins, FaClock, FaRocket, FaStar, FaShieldAlt } from "react-icons/fa";
import Dialog from "./Dialog";
import { useTranslation } from "next-i18next";
import { authEnabled } from "../utils/env-helper";
import { DEMO_TOKEN_LIMIT } from "../utils/constants";
import TokenBalance from "./TokenBalance";

export default function HelpDialog({
  show,
  close,
  sessionToken,
}: {
  show: boolean;
  close: () => void;
  sessionToken?: string;
}) {
  const { t } = useTranslation("help");
  const [currentStep, setCurrentStep] = useState(0);
  const [isFirstTime, setIsFirstTime] = useState(false);

  useEffect(() => {
    // Check if this is the user's first visit
    const hasVisited = localStorage.getItem("autogpt-has-visited");
    if (!hasVisited && show) {
      setIsFirstTime(true);
      localStorage.setItem("autogpt-has-visited", "true");
    }
  }, [show]);

  const steps = [
    {
      title: "🎉 Welcome to AutoGPT Next Web!",
      content: (
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 p-4 rounded-lg border border-blue-500/30">
            <h3 className="text-lg font-bold text-blue-300 mb-2 flex items-center gap-2">
              <FaRocket />
              Your Free Demo Awaits!
            </h3>
            <p className="text-blue-100">
              You've been granted <strong className="text-yellow-300">{DEMO_TOKEN_LIMIT.toLocaleString()} free tokens</strong> to explore our AI capabilities!
            </p>
            {sessionToken && (
              <div className="mt-3">
                <TokenBalance
                  sessionToken={sessionToken}
                  className="text-sm bg-blue-900/30 p-2 rounded border border-blue-500/50"
                />
              </div>
            )}
          </div>

          <div className="bg-green-900/30 p-4 rounded-lg border border-green-500/30">
            <h4 className="font-bold text-green-300 mb-2 flex items-center gap-2">
              <FaStar />
              What You Can Do:
            </h4>
            <ul className="text-green-100 space-y-1 text-sm">
              <li>• Create autonomous AI agents with custom goals</li>
              <li>• Choose from multiple AI providers (Groq, OpenRouter, Cohere)</li>
              <li>• Enable web search for real-time information</li>
              <li>• Watch your AI agent break down and complete complex tasks</li>
            </ul>
          </div>
        </div>
      )
    },
    {
      title: "🔧 How It Works",
      content: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-600">
              <h4 className="font-bold text-white mb-2">1. Set Your Goal</h4>
              <p className="text-gray-300 text-sm">Define what you want your AI agent to accomplish</p>
            </div>
            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-600">
              <h4 className="font-bold text-white mb-2">2. Choose Your AI</h4>
              <p className="text-gray-300 text-sm">Select from Groq, OpenRouter, or Cohere models</p>
            </div>
            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-600">
              <h4 className="font-bold text-white mb-2">3. Deploy & Watch</h4>
              <p className="text-gray-300 text-sm">Your agent will create and execute tasks autonomously</p>
            </div>
            <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-600">
              <h4 className="font-bold text-white mb-2">4. Get Results</h4>
              <p className="text-gray-300 text-sm">Review completed tasks and generated content</p>
            </div>
          </div>

          <div className="bg-yellow-900/30 p-4 rounded-lg border border-yellow-500/30">
            <h4 className="font-bold text-yellow-300 mb-2 flex items-center gap-2">
              <FaCoins />
              Token Usage:
            </h4>
            <p className="text-yellow-100 text-sm">
              Each AI interaction consumes tokens. More complex tasks use more tokens.
              Your allowance resets 24 hours after your last activity.
            </p>
          </div>
        </div>
      )
    },
    {
      title: "🚀 Ready to Start?",
      content: (
        <div className="space-y-4">
          <div className="bg-purple-900/30 p-4 rounded-lg border border-purple-500/30">
            <h4 className="font-bold text-purple-300 mb-2">Quick Start Guide:</h4>
            <ol className="text-purple-100 space-y-2 text-sm list-decimal list-inside">
              <li>Click the <strong>Settings</strong> button to configure your preferred AI provider</li>
              <li>Enter an <strong>Agent Name</strong> (e.g., "ResearchBot")</li>
              <li>Set a clear <strong>Goal</strong> (e.g., "Research the latest AI developments")</li>
              <li>Enable <strong>Web Search</strong> for current information</li>
              <li>Click <strong>Deploy Agent</strong> and watch the magic happen!</li>
            </ol>
          </div>

          <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-600">
            <h4 className="font-bold text-white mb-2 flex items-center gap-2">
              <FaShieldAlt />
              Your Privacy & Security:
            </h4>
            <ul className="text-gray-300 space-y-1 text-sm">
              <li>• No account required for demo access</li>
              <li>• Session data is temporarily stored for functionality</li>
              <li>• No personal information collected</li>
              <li>• All AI processing happens securely</li>
            </ul>
          </div>

          <div className="bg-blue-900/30 p-4 rounded-lg border border-blue-500/30">
            <h4 className="font-bold text-blue-300 mb-2">Need More Tokens?</h4>
            <p className="text-blue-100 text-sm">
              When your demo tokens run out, you can get unlimited access by signing up for free API keys from
              Groq, OpenRouter, or Cohere. Just enter your API key in settings!
            </p>
          </div>
        </div>
      )
    }
  ];

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      close();
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleClose = () => {
    setCurrentStep(0);
    close();
  };

  return (
    <Dialog
      header={
        <div className="flex items-center justify-between w-full">
          <span className="flex items-center gap-2">
            {steps[currentStep].title}
          </span>
          {isFirstTime && (
            <div className="flex items-center gap-2 bg-yellow-900/30 px-3 py-1 rounded-full border border-yellow-500/50">
              <FaCoins className="text-yellow-400" />
              <span className="text-yellow-300 font-mono text-sm">
                {DEMO_TOKEN_LIMIT.toLocaleString()} Tokens
              </span>
            </div>
          )}
        </div>
      }
      isShown={show}
      close={handleClose}
      footerButton={
        <div className="flex gap-2">
          {currentStep > 0 && (
            <button
              onClick={prevStep}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors"
            >
              Previous
            </button>
          )}
          <button
            onClick={nextStep}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            {currentStep < steps.length - 1 ? "Next" : "Get Started!"}
          </button>
        </div>
      }
    >
      <div className="min-h-[400px]">
        {steps[currentStep].content}

        {isFirstTime && (
          <div className="mt-6 flex justify-center">
            <div className="flex space-x-2">
              {steps.map((_, index) => (
                <div
                  key={index}
                  className={`w-3 h-3 rounded-full transition-colors ${
                    index === currentStep ? "bg-blue-500" : "bg-gray-600"
                  }`}
                />
              ))}
            </div>
          </div>
        )}

        {!isFirstTime && (
          <div className="mt-6">
            <div className="text-md relative flex-auto p-2 leading-relaxed">
              <p>
                <strong>AutoGPT</strong> {t("usage")} 🚀
              </p>
              <div>
                <br />
                {t("working-on")}
                <ul className="ml-5 list-inside list-disc">
                  <li>{t("long-term-memory")} 🧠</li>
                  <li>{t("web-browsing")} 🌐</li>
                  <li>{t("interaction-with-websites-and-people")} 👨‍👩‍👦</li>
                </ul>
                <br />
                <p className="mt-2">{t("follow-our-footsteps")}</p>
              </div>
              <div className="mt-4 flex w-full items-center justify-center gap-5">
                {authEnabled && (
                  <div
                    className="cursor-pointer rounded-full bg-black/30 p-3 hover:bg-black/70"
                    onClick={() =>
                      window.open("https://discord.gg/Xnsbhg6Uvd", "_blank")
                    }
                  >
                    <FaDiscord size={30} />
                  </div>
                )}
                <div
                  className="cursor-pointer rounded-full bg-black/30 p-3 hover:bg-black/70"
                  onClick={() =>
                    window.open(
                      "https://github.com/Dogtiti/AutoGPT-Next-Web",
                      "_blank"
                    )
                  }
                >
                  <FaGithub size={30} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}