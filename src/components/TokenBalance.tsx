// src/components/TokenBalance.tsx

import React, { useEffect, useState } from "react";
import { FaCoins, FaClock, FaExclamationTriangle } from "react-icons/fa";
import { useTranslation } from "next-i18next";
import { DEMO_TOKEN_LIMIT } from "../utils/constants";
import clsx from "clsx";

interface TokenStatus {
  tokensUsed: number;
  tokensRemaining: number;
  resetAt: string;
  timeUntilReset: number;
  canUseTokens: boolean;
}

interface TokenBalanceProps {
  sessionToken: string;
  onTokensExhausted?: () => void;
  className?: string;
}

const TokenBalance: React.FC<TokenBalanceProps> = ({
  sessionToken,
  onTokensExhausted,
  className
}) => {
  const { t } = useTranslation();
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTokenStatus = async () => {
    if (!sessionToken) return;

    try {
      const response = await fetch(`/api/tokens/manage?sessionToken=${encodeURIComponent(sessionToken)}`);

      if (response.ok) {
        const data = await response.json();
        setTokenStatus(data);

        if (!data.canUseTokens && onTokensExhausted) {
          onTokensExhausted();
        }
      } else {
        throw new Error('Failed to fetch token status');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTokenStatus();

    // Refresh every 30 seconds
    const interval = setInterval(fetchTokenStatus, 30000);
    return () => clearInterval(interval);
  }, [sessionToken]);

  const formatTimeRemaining = (milliseconds: number): string => {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const getProgressBarColor = (remaining: number): string => {
    const percentage = (remaining / DEMO_TOKEN_LIMIT) * 100;

    if (percentage > 50) return "bg-green-500";
    if (percentage > 25) return "bg-yellow-500";
    if (percentage > 10) return "bg-orange-500";
    return "bg-red-500";
  };

  const getTextColor = (remaining: number): string => {
    const percentage = (remaining / DEMO_TOKEN_LIMIT) * 100;

    if (percentage > 25) return "text-white";
    if (percentage > 10) return "text-yellow-300";
    return "text-red-300";
  };

  if (loading) {
    return (
      <div className={clsx("flex items-center gap-2 text-sm text-gray-400", className)}>
        <FaCoins className="animate-pulse" />
        <span>{t("loading-tokens")}</span>
      </div>
    );
  }

  if (error || !tokenStatus) {
    return (
      <div className={clsx("flex items-center gap-2 text-sm text-red-400", className)}>
        <FaExclamationTriangle />
        <span>{t("token-error")}</span>
      </div>
    );
  }

  const progressPercentage = (tokenStatus.tokensRemaining / DEMO_TOKEN_LIMIT) * 100;

  return (
    <div className={clsx("flex flex-col gap-2 p-3 rounded-lg border-2 border-white/20 bg-zinc-800", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FaCoins className={getTextColor(tokenStatus.tokensRemaining)} />
          <span className="text-sm font-mono font-bold text-white">
            {t("demo-tokens")}
          </span>
        </div>
        {tokenStatus.tokensRemaining === 0 && (
          <FaExclamationTriangle className="text-red-400" />
        )}
      </div>

      {/* Progress Bar */}
      <div className="relative">
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div
            className={clsx("h-2 rounded-full transition-all duration-300", getProgressBarColor(tokenStatus.tokensRemaining))}
            style={{ width: `${Math.max(progressPercentage, 2)}%` }}
          />
        </div>
      </div>

      {/* Token Count */}
      <div className="flex items-center justify-between text-xs">
        <span className={getTextColor(tokenStatus.tokensRemaining)}>
          {tokenStatus.tokensRemaining.toLocaleString()} / {DEMO_TOKEN_LIMIT.toLocaleString()}
        </span>
        <span className="text-gray-400">
          {t("used")}: {tokenStatus.tokensUsed.toLocaleString()}
        </span>
      </div>

      {/* Reset Timer */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <FaClock />
        <span>
          {t("resets-in")}: {formatTimeRemaining(tokenStatus.timeUntilReset)}
        </span>
      </div>

      {/* Warning Message */}
      {tokenStatus.tokensRemaining <= 1000 && tokenStatus.tokensRemaining > 0 && (
        <div className="text-xs text-yellow-300 bg-yellow-900/20 p-2 rounded border border-yellow-500/30">
          ⚠️ {t("low-tokens-warning")}
        </div>
      )}

      {/* Exhausted Message */}
      {tokenStatus.tokensRemaining === 0 && (
        <div className="text-xs text-red-300 bg-red-900/20 p-2 rounded border border-red-500/30">
          🚫 {t("tokens-exhausted")}
        </div>
      )}
    </div>
  );
};

export default TokenBalance;