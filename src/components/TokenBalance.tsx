// src/components/TokenBalance.tsx

import React, { useEffect, useState } from "react";
import { FaCoins, FaClock, FaExclamationTriangle, FaCheckCircle, FaBolt } from "react-icons/fa";
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
  compact?: boolean;
  showDetails?: boolean;
}

const TokenBalance: React.FC<TokenBalanceProps> = ({
  sessionToken,
  onTokensExhausted,
  className,
  compact = false,
  showDetails = true
}) => {
  const { t } = useTranslation();
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previousRemaining, setPreviousRemaining] = useState<number | null>(null);

  const fetchTokenStatus = async () => {
    if (!sessionToken) return;

    try {
      const response = await fetch(`/api/tokens/manage?sessionToken=${encodeURIComponent(sessionToken)}`);

      if (response.ok) {
        const data = await response.json();

        // Check if tokens decreased (consumption occurred)
        if (previousRemaining !== null && data.tokensRemaining < previousRemaining) {
          // Show brief animation for token consumption
        }

        setPreviousRemaining(data.tokensRemaining);
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

    // Refresh every 10 seconds for real-time updates
    const interval = setInterval(fetchTokenStatus, 10000);
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

    if (percentage > 50) return "bg-gradient-to-r from-green-500 to-green-400";
    if (percentage > 25) return "bg-gradient-to-r from-yellow-500 to-yellow-400";
    if (percentage > 10) return "bg-gradient-to-r from-orange-500 to-orange-400";
    return "bg-gradient-to-r from-red-500 to-red-400";
  };

  const getTextColor = (remaining: number): string => {
    const percentage = (remaining / DEMO_TOKEN_LIMIT) * 100;

    if (percentage > 25) return "text-white";
    if (percentage > 10) return "text-yellow-300";
    return "text-red-300";
  };

  const getStatusIcon = (remaining: number) => {
    const percentage = (remaining / DEMO_TOKEN_LIMIT) * 100;

    if (remaining === 0) return <FaExclamationTriangle className="text-red-400" />;
    if (percentage > 50) return <FaCheckCircle className="text-green-400" />;
    if (percentage > 25) return <FaBolt className="text-yellow-400" />;
    return <FaExclamationTriangle className="text-orange-400" />;
  };

  if (loading && !compact) {
    return (
      <div className={clsx("flex items-center gap-2 text-sm text-gray-400", className)}>
        <FaCoins className="animate-pulse" />
        <span>{t("loading-tokens")}</span>
      </div>
    );
  }

  if (error || !tokenStatus) {
    if (compact) return null;
    return (
      <div className={clsx("flex items-center gap-2 text-sm text-red-400", className)}>
        <FaExclamationTriangle />
        <span>{t("token-error")}</span>
      </div>
    );
  }

  const progressPercentage = (tokenStatus.tokensRemaining / DEMO_TOKEN_LIMIT) * 100;

  if (compact) {
    return (
      <div className={clsx("flex items-center gap-2", className)}>
        <FaCoins className={getTextColor(tokenStatus.tokensRemaining)} />
        <span className={clsx("font-mono font-bold", getTextColor(tokenStatus.tokensRemaining))}>
          {tokenStatus.tokensRemaining.toLocaleString()}
        </span>
        <span className="text-gray-400 text-sm">/ {DEMO_TOKEN_LIMIT.toLocaleString()}</span>
      </div>
    );
  }

  return (
    <div className={clsx(
      "relative overflow-hidden transition-all duration-300",
      "bg-gradient-to-br from-gray-800 to-gray-900 border-2 rounded-lg shadow-lg",
      tokenStatus.tokensRemaining > 0
        ? "border-blue-500/30 hover:border-blue-400/50"
        : "border-red-500/50 hover:border-red-400/70",
      className
    )}>
      {/* Background gradient effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-blue-600/5 to-purple-600/5" />

      <div className="relative p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon(tokenStatus.tokensRemaining)}
            <span className="text-sm font-mono font-bold text-white">
              Demo Tokens
            </span>
          </div>
          <div className="text-xs text-gray-400 font-mono">
            {((tokenStatus.tokensRemaining / DEMO_TOKEN_LIMIT) * 100).toFixed(1)}%
          </div>
        </div>

        {/* Progress Bar */}
        <div className="relative">
          <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className={clsx(
                "h-3 rounded-full transition-all duration-500 ease-out",
                getProgressBarColor(tokenStatus.tokensRemaining),
                "shadow-sm"
              )}
              style={{ width: `${Math.max(progressPercentage, 2)}%` }}
            />
          </div>

          {/* Pulse effect for low tokens */}
          {tokenStatus.tokensRemaining <= 1000 && tokenStatus.tokensRemaining > 0 && (
            <div className="absolute inset-0 rounded-full animate-pulse bg-yellow-400/20" />
          )}
        </div>

        {/* Token Count */}
        <div className="flex items-center justify-between">
          <div className={clsx("font-mono text-lg font-bold", getTextColor(tokenStatus.tokensRemaining))}>
            {tokenStatus.tokensRemaining.toLocaleString()}
            <span className="text-gray-400 text-sm ml-1">
              / {DEMO_TOKEN_LIMIT.toLocaleString()}
            </span>
          </div>

          {showDetails && (
            <div className="text-xs text-gray-400">
              Used: {tokenStatus.tokensUsed.toLocaleString()}
            </div>
          )}
        </div>

        {/* Reset Timer */}
        {showDetails && (
          <div className="flex items-center gap-2 text-xs text-gray-400 border-t border-gray-600 pt-2">
            <FaClock />
            <span>
              Resets in: {formatTimeRemaining(tokenStatus.timeUntilReset)}
            </span>
          </div>
        )}

        {/* Status Messages */}
        {tokenStatus.tokensRemaining <= 2000 && tokenStatus.tokensRemaining > 0 && (
          <div className="text-xs bg-yellow-900/30 text-yellow-300 p-2 rounded border border-yellow-500/30">
            ⚠️ {tokenStatus.tokensRemaining <= 1000 ? "Very low tokens remaining!" : "Running low on tokens"}
          </div>
        )}

        {tokenStatus.tokensRemaining === 0 && (
          <div className="text-xs bg-red-900/30 text-red-300 p-2 rounded border border-red-500/30">
            🚫 No tokens remaining. Get free API keys to continue!
          </div>
        )}

        {/* High usage celebration */}
        {tokenStatus.tokensUsed >= DEMO_TOKEN_LIMIT * 0.1 && tokenStatus.tokensRemaining > 0 && (
          <div className="text-xs bg-blue-900/30 text-blue-300 p-2 rounded border border-blue-500/30">
            🎉 Great job exploring AutoGPT! Consider getting your own API key for unlimited access.
          </div>
        )}
      </div>
    </div>
  );
};

export default TokenBalance;