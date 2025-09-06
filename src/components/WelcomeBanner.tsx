// src/components/WelcomeBanner.tsx

import React, { useState, useEffect } from "react";
import { FaCoins, FaRocket, FaTimes, FaInfoCircle, FaGift } from "react-icons/fa";
import { useTranslation } from "next-i18next";
import { DEMO_TOKEN_LIMIT } from "../utils/constants";
import Expand from "./motions/expand";
import FadeIn from "./motions/FadeIn";

interface WelcomeBannerProps {
  sessionToken?: string;
  onShowHelp: () => void;
  onDismiss?: () => void;
}

const WelcomeBanner: React.FC<WelcomeBannerProps> = ({
  sessionToken,
  onShowHelp,
  onDismiss
}) => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [isFirstTime, setIsFirstTime] = useState(false);

  useEffect(() => {
    const hasSeenBanner = localStorage.getItem("autogpt-welcome-banner-seen");
    const hasVisited = localStorage.getItem("autogpt-has-visited");

    if (!hasSeenBanner && !hasVisited) {
      setIsFirstTime(true);
      setIsVisible(true);
    }
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    localStorage.setItem("autogpt-welcome-banner-seen", "true");
    onDismiss?.();
  };

  const handleLearnMore = () => {
    onShowHelp();
    handleDismiss();
  };

  if (!isVisible || !isFirstTime) return null;

  return (
    <FadeIn delay={0.3}>
      <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-md w-full mx-4">
        <Expand delay={0.5}>
          <div className="relative bg-gradient-to-r from-blue-600/90 to-purple-600/90 backdrop-blur-md border-2 border-blue-400/50 rounded-xl shadow-2xl overflow-hidden">
            {/* Background pattern */}
            <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent" />

            {/* Close button */}
            <button
              onClick={handleDismiss}
              className="absolute top-2 right-2 text-white/70 hover:text-white transition-colors p-1"
            >
              <FaTimes size={14} />
            </button>

            <div className="relative p-4 space-y-3">
              {/* Header */}
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-8 h-8 bg-yellow-500/20 rounded-full border border-yellow-400/50">
                  <FaGift className="text-yellow-400" size={16} />
                </div>
                <div>
                  <h3 className="text-white font-bold text-sm">Welcome to AutoGPT!</h3>
                  <p className="text-blue-100 text-xs">Your free demo is ready</p>
                </div>
              </div>

              {/* Token display */}
              <div className="bg-yellow-500/20 border border-yellow-400/30 rounded-lg p-3">
                <div className="flex items-center justify-center gap-2">
                  <FaCoins className="text-yellow-400" />
                  <span className="text-yellow-100 font-mono font-bold">
                    {DEMO_TOKEN_LIMIT.toLocaleString()} Free Tokens
                  </span>
                </div>
                <p className="text-yellow-200 text-xs text-center mt-1">
                  No signup required • Resets in 24h
                </p>
              </div>

              {/* Quick features */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white/10 rounded p-2">
                  <div className="text-white font-medium">🤖 AI Agents</div>
                  <div className="text-blue-200">Autonomous task execution</div>
                </div>
                <div className="bg-white/10 rounded p-2">
                  <div className="text-white font-medium">🌐 Web Search</div>
                  <div className="text-blue-200">Real-time information</div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleLearnMore}
                  className="flex-1 bg-white/20 hover:bg-white/30 text-white text-xs font-medium py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1"
                >
                  <FaInfoCircle size={12} />
                  Learn More
                </button>
                <button
                  onClick={handleDismiss}
                  className="flex-1 bg-blue-500 hover:bg-blue-400 text-white text-xs font-medium py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1"
                >
                  <FaRocket size={12} />
                  Get Started
                </button>
              </div>
            </div>

            {/* Animated border */}
            <div className="absolute inset-0 rounded-xl border-2 border-transparent bg-gradient-to-r from-blue-400 via-purple-400 to-blue-400 bg-clip-border animate-pulse opacity-30" />
          </div>
        </Expand>
      </div>
    </FadeIn>
  );
};

export default WelcomeBanner;