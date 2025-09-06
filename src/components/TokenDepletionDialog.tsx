// src/components/TokenDepletionDialog.tsx

import React from "react";
import Dialog from "./Dialog";
import Button from "./Button";
import { FaCoins, FaExternalLinkAlt, FaClock } from "react-icons/fa";
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
      url: "https://console.groq.com/",
      description: "Fast inference for Llama, Mistral, and more"
    },
    {
      name: "OpenRouter",
      url: "https://openrouter.ai/",
      description: "Access to Claude, GPT-4, and 100+ models"
    },
    {
      name: "Cohere",
      url: "https://cohere.com/",
      description: "Command models for chat and generation"
    }
  ];

  return (
    <Dialog
      header={
        <div className="flex items-center gap-2 text-orange-400">
          <FaCoins />
          <span>{t("demo-limit-reached")}</span>
        </div>
      }
      isShown={show}
      close={close}
      footerButton={
        <Button onClick={close} enabledClassName="bg-blue-600 hover:bg-blue-500">
          {t("common:understood")}
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Thank you message */}
        <div className="bg-blue-900/30 p-4 rounded-lg border border-blue-500/30">
          <h3 className="text-lg font-bold text-blue-300 mb-2">
            {t("thank-you-for-trying")}
          </h3>
          <p className="text-blue-100">
            {t("demo-tokens-exhausted", { count: DEMO_TOKEN_LIMIT.toLocaleString() })}
          </p>
        </div>

        {/* Reset information */}
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-600">
          <div className="flex items-center gap-2 mb-2">
            <FaClock className="text-yellow-400" />
            <h4 className="font-bold text-yellow-300">{t("when-tokens-reset")}</h4>
          </div>
          <p className="text-gray-300">
            {t("tokens-reset-in", { time: formatResetTime(resetTime) })}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {t("reset-based-on-activity")}
          </p>
        </div>

        {/* Get your own API keys */}
        <div className="bg-green-900/30 p-4 rounded-lg border border-green-500/30">
          <h4 className="font-bold text-green-300 mb-3">
            {t("get-unlimited-access")}
          </h4>
          <p className="text-green-100 mb-4">
            {t("free-api-keys-available")}
          </p>

          <div className="space-y-3">
            {providerLinks.map((provider) => (
              <div key={provider.name} className="flex items-center justify-between p-3 bg-gray-800/50 rounded border border-gray-600">
                <div>
                  <div className="font-bold text-white">{provider.name}</div>
                  <div className="text-sm text-gray-400">{provider.description}</div>
                </div>
                <Button
                  onClick={() => window.open(provider.url, '_blank')}
                  className="text-sm px-3 py-1"
                  enabledClassName="bg-green-600 hover:bg-green-500"
                >
                  <FaExternalLinkAlt className="mr-1" size={12} />
                  {t("sign-up")}
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Benefits of own API */}
        <div className="bg-purple-900/30 p-4 rounded-lg border border-purple-500/30">
          <h4 className="font-bold text-purple-300 mb-2">
            {t("benefits-own-api")}
          </h4>
          <ul className="text-purple-100 space-y-1 text-sm">
            <li>• {t("unlimited-requests")}</li>
            <li>• {t("faster-responses")}</li>
            <li>• {t("access-all-models")}</li>
            <li>• {t("no-daily-limits")}</li>
            <li>• {t("priority-support")}</li>
          </ul>
        </div>

        {/* How to use own API */}
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-600">
          <h4 className="font-bold text-gray-300 mb-2">
            {t("how-to-use-own-api")}
          </h4>
          <ol className="text-gray-300 space-y-1 text-sm list-decimal list-inside">
            <li>{t("sign-up-provider")}</li>
            <li>{t("get-api-key")}</li>
            <li>{t("enter-settings")}</li>
            <li>{t("paste-api-key")}</li>
            <li>{t("enjoy-unlimited")}</li>
          </ol>
        </div>
      </div>
    </Dialog>
  );
};