// src/components/TokenDepletionDialog.tsx

import React from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import { FaCoins, FaExternalLinkAlt, FaClock, FaRocket, FaKey, FaGift } from "react-icons/fa";
import { useTranslation } from "next-i18next";
import { DEMO_TOKEN_LIMIT, TOKEN_RESET_HOURS } from "../utils/constants";

export interface TokenDepletionDialogProps {
  show: boolean;
  close: () => void;
  resetTime?: string;
}

export const TokenDepletionDialog = ({ show, close, resetTime }: TokenDepletionDialogProps) => {
  const { t } = useTranslation(["chat", "common"]);

  const formatResetTime = (resetTimeString?: string): string => {
    if (!resetTimeString) return `${TOKEN_RESET_HOURS} hours`;

    const resetDate = new Date(resetTimeString);
    const now = new Date();
    const diffMs = resetDate.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffHours > 0) {
      return `${diffHours}h ${diffMinutes}m`;
    }
    return `${diffMinutes}m`;
  };

  const providerLinks = [
    {
      name: "Groq",
      url: "https://console.groq.com/home",
      description: "Lightning-fast inference for Llama, Mixtral, and more",
      features: ["Free tier with rate limits", "Fastest inference speeds", "Multiple model options"],
      color: "from-orange-500 to-red-500"
    },
    {
      name: "OpenRouter",
      url: "https://openrouter.ai/",
      description: "Access Claude, GPT-4, and 100+ models in one place",
      features: ["Pay-per-use pricing", "Huge model selection", "Easy API integration"],
      color: "from-blue-500 to-purple-500"
    },
    {
      name: "Cohere",
      url: "https://cohere.com/",
      description: "Powerful Command models for enterprise use",
      features: ["Free trial credits", "Production-ready models", "Enterprise support"],
      color: "from-green-500 to-blue-500"
    }
  ];

  return (
    <Dialog
      header={
        <div className="flex items-center gap-3 text-orange-400">
          <div className="flex items-center justify-center w-10 h-10 bg-orange-500/20 rounded-full border border-orange-400/50">
            <FaCoins size={20} />
          </div>
          <div>
            <div className="text-xl font-bold">Demo Tokens Exhausted</div>
            <div className="text-sm text-orange-300 font-normal">Continue with your own API key</div>
          </div>
        </div>
      }
      isShown={show}
      close={close}
      footerButton={
        <Button onClick={close} enabledClassName="bg-blue-600 hover:bg-blue-500">
          <FaRocket className="mr-2" size={14} />
          Got it!
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Thank you message */}
        <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 p-4 rounded-xl border border-blue-500/30">
          <div className="flex items-center gap-3 mb-3">
            <FaGift className="text-blue-400" size={24} />
            <h3 className="text-lg font-bold text-blue-300">
              Thank You for Exploring AutoGPT!
            </h3>
          </div>
          <p className="text-blue-100">
            You've used all <strong className="text-yellow-300">{DEMO_TOKEN_LIMIT.toLocaleString()} demo tokens</strong> and
            experienced the power of autonomous AI agents. Amazing work! 🎉
          </p>
        </div>

        {/* Reset information */}
        <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-600">
          <div className="flex items-center gap-2 mb-2">
            <FaClock className="text-yellow-400" />
            <h4 className="font-bold text-yellow-300">When Demo Tokens Reset</h4>
          </div>
          <p className="text-gray-300">
            Your demo tokens will reset in <strong className="text-yellow-300">{formatResetTime(resetTime)}</strong>
          </p>
          <p className="text-sm text-gray-400 mt-1">
            ⏰ Reset happens 24 hours after your last activity
          </p>
        </div>

        {/* Get unlimited access */}
        <div className="bg-gradient-to-br from-green-600/20 to-emerald-600/20 p-4 rounded-xl border border-green-500/30">
          <div className="flex items-center gap-3 mb-3">
            <FaKey className="text-green-400" size={20} />
            <h4 className="font-bold text-green-300">Get Unlimited Access - FREE!</h4>
          </div>
          <p className="text-green-100 mb-4">
            Continue using AutoGPT with <strong>unlimited requests</strong> by getting a free API key from any provider below:
          </p>

          <div className="space-y-4">
            {providerLinks.map((provider) => (
              <div key={provider.name} className="group">
                <div className={`bg-gradient-to-r ${provider.color} p-[1px] rounded-xl`}>
                  <div className="bg-gray-900 rounded-xl p-4 group-hover:bg-gray-800/80 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="font-bold text-white text-lg">{provider.name}</div>
                        <div className="text-sm text-gray-300">{provider.description}</div>
                      </div>
                      <Button
                        onClick={() => window.open(provider.url, '_blank')}
                        className="text-sm px-4 py-2"
                        enabledClassName="bg-white/10 hover:bg-white/20 border-white/20"
                      >
                        <FaExternalLinkAlt className="mr-2" size={12} />
                        Get Free Key
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                      {provider.features.map((feature, idx) => (
                        <div key={idx} className="bg-white/5 rounded p-2 text-gray-300">
                          ✓ {feature}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Simple steps */}
        <div className="bg-purple-900/30 p-4 rounded-xl border border-purple-500/30">
          <h4 className="font-bold text-purple-300 mb-3 flex items-center gap-2">
            <FaRocket />
            How to Continue (3 Simple Steps):
          </h4>
          <ol className="text-purple-100 space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <span className="bg-purple-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold mt-0.5">1</span>
              <span><strong>Create FREE account</strong> with any provider above (takes 2 minutes)</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="bg-purple-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold mt-0.5">2</span>
              <span><strong>Generate your API key</strong> in their dashboard</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="bg-purple-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold mt-0.5">3</span>
              <span><strong>Enter it in Settings</strong> here for unlimited access</span>
            </li>
          </ol>
        </div>

        {/* Benefits reminder */}
        <div className="bg-gradient-to-r from-indigo-600/20 to-purple-600/20 p-4 rounded-xl border border-indigo-500/30">
          <h4 className="font-bold text-indigo-300 mb-2">
            🚀 With Your Own API Key You Get:
          </h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-indigo-100">• Unlimited requests</div>
            <div className="text-indigo-100">• Faster responses</div>
            <div className="text-indigo-100">• All AI models</div>
            <div className="text-indigo-100">• No daily limits</div>
            <div className="text-indigo-100">• Priority access</div>
            <div className="text-indigo-100">• Advanced features</div>
          </div>
        </div>

        {/* Encouragement */}
        <div className="text-center bg-gray-800/30 p-4 rounded-xl border border-gray-600">
          <p className="text-gray-300 text-sm">
            🎯 <strong>You've seen what's possible!</strong> Now unlock the full potential of autonomous AI with unlimited access.
          </p>
        </div>
      </div>
    </Dialog>
  );
};