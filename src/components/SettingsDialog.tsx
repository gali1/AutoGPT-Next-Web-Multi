// src/components/SettingsDialog.tsx

import React, { useEffect } from "react";
import { useTranslation, Trans } from "next-i18next";
import Button from "./Button";
import {
  FaKey,
  FaMicrochip,
  FaThermometerFull,
  FaExclamationCircle,
  FaSyncAlt,
  FaCoins,
  FaCode,
  FaServer,
  FaSearch,
  FaCog,
} from "react-icons/fa";
import Dialog from "./Dialog";
import Input from "./Input";
import {
  GROQ_MODELS,
  OPENROUTER_MODELS,
  COHERE_MODELS,
  LLM_PROVIDERS,
  PROVIDER_NAMES,
  MODEL_DISPLAY_NAMES,
  DEFAULT_MODELS,
} from "../utils/constants";
import Accordion from "./Accordion";
import type { ModelSettings, SettingModel, LLMProvider } from "../utils/types";
import { useGuestMode } from "../hooks/useGuestMode";
import clsx from "clsx";

export const SettingsDialog: React.FC<{
  show: boolean;
  close: () => void;
  customSettings: SettingModel;
}> = ({ show, close, customSettings }) => {
  const [settings, setSettings] = React.useState<ModelSettings>({
    ...customSettings.settings,
  });
  const { isGuestMode } = useGuestMode(settings.customGuestKey);
  const { t } = useTranslation(["settings", "common"]);

  useEffect(() => {
    setSettings(customSettings.settings);
  }, [customSettings, close]);

  const updateSettings = <Key extends keyof ModelSettings>(
    key: Key,
    value: ModelSettings[Key]
  ) => {
    setSettings((prev) => {
      return { ...prev, [key]: value };
    });
  };

  const getApiKey = (provider: LLMProvider): string => {
    switch (provider) {
      case "groq":
        return settings.groqApiKey || settings.customApiKey || "";
      case "openrouter":
        return settings.openrouterApiKey || settings.customApiKey || "";
      case "cohere":
        return settings.cohereApiKey || settings.customApiKey || "";
      default:
        return settings.customApiKey || "";
    }
  };

  const keyIsValid = (key: string | undefined) => {
    if (!key) return false;
    // Basic validation - check for minimum length and format
    return key.length > 20;
  };

  const urlIsValid = (url: string | undefined) => {
    if (url) {
      const pattern = /^(https?:\/\/)?[\w.-]+\.[a-zA-Z]{2,}(\/\S*)?$/;
      return pattern.test(url);
    }
    return true;
  };

  const getCurrentProvider = (): LLMProvider => {
    return settings.llmProvider || "groq";
  };

  const getCurrentModels = () => {
    const provider = getCurrentProvider();
    switch (provider) {
      case "groq":
        return GROQ_MODELS;
      case "openrouter":
        return OPENROUTER_MODELS;
      case "cohere":
        return COHERE_MODELS;
      default:
        return GROQ_MODELS;
    }
  };

  const getCurrentModelName = () => {
    return settings.customModelName || DEFAULT_MODELS[getCurrentProvider()];
  };

  const handleSave = () => {
    const provider = getCurrentProvider();
    const apiKey = getApiKey(provider);

    if (!isGuestMode && !keyIsValid(apiKey)) {
      alert(t("Key is invalid, please ensure you have set up a valid API key!"));
      return;
    }

    if (!urlIsValid(settings.customEndPoint)) {
      alert(t("Endpoint URL is invalid. Please ensure that you have set a correct URL."));
      return;
    }

    customSettings.saveSettings(settings);
    close();
    return;
  };

  const handleReset = () => {
    customSettings.resetSettings();
    close();
  };

  const currentProvider = getCurrentProvider();
  const disabled = !isGuestMode && !getApiKey(currentProvider);

  const providerSettings = (
    <div className="flex flex-col gap-2">
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">{t("llm-provider")}</label>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(LLM_PROVIDERS).map(([key, value]) => (
            <button
              key={value}
              type="button"
              className={clsx(
                "p-2 rounded-lg border-2 transition-all text-center",
                currentProvider === value
                  ? "border-[#1E88E5] bg-[#1E88E5]/20"
                  : "border-white/20 hover:border-white/40"
              )}
              onClick={() => updateSettings("llmProvider", value)}
            >
              {PROVIDER_NAMES[value]}
            </button>
          ))}
        </div>
      </div>

      {currentProvider === "groq" && (
        <Input
          left={
            <>
              <FaKey />
              <span className="ml-2">{t("groq-api-key")}</span>
            </>
          }
          placeholder="gsk-..."
          value={settings.groqApiKey || ""}
          onChange={(e) => updateSettings("groqApiKey", e.target.value)}
          type="password"
        />
      )}

      {currentProvider === "openrouter" && (
        <Input
          left={
            <>
              <FaKey />
              <span className="ml-2">{t("openrouter-api-key")}</span>
            </>
          }
          placeholder="sk-or-v1-..."
          value={settings.openrouterApiKey || ""}
          onChange={(e) => updateSettings("openrouterApiKey", e.target.value)}
          type="password"
        />
      )}

      {currentProvider === "cohere" && (
        <Input
          left={
            <>
              <FaKey />
              <span className="ml-2">{t("cohere-api-key")}</span>
            </>
          }
          placeholder="..."
          value={settings.cohereApiKey || ""}
          onChange={(e) => updateSettings("cohereApiKey", e.target.value)}
          type="password"
        />
      )}

      <Input
        left={
          <>
            <FaMicrochip />
            <span className="ml-2">{t("model")}</span>
          </>
        }
        type="combobox"
        value={getCurrentModelName()}
        onChange={() => null}
        setValue={(value) => updateSettings("customModelName", value)}
        attributes={{
          options: getCurrentModels().map(model => ({
            value: model,
            label: MODEL_DISPLAY_NAMES[model as keyof typeof MODEL_DISPLAY_NAMES] || model
          })).map(item => item.value)
        }}
        disabled={disabled}
      />
    </div>
  );

  const webSearchSettings = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 mb-2">
        <input
          type="checkbox"
          id="enableWebSearch"
          checked={settings.enableWebSearch || false}
          onChange={(e) => updateSettings("enableWebSearch", e.target.checked)}
          className="rounded"
        />
        <label htmlFor="enableWebSearch" className="text-sm font-medium">
          {t("enable-web-search")}
        </label>
      </div>

      {settings.enableWebSearch && (
        <div className="ml-6">
          <label className="block text-sm font-medium mb-2">{t("search-provider")}</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={clsx(
                "p-2 rounded-lg border-2 transition-all text-center",
                (settings.webSearchProvider || "google") === "google"
                  ? "border-[#1E88E5] bg-[#1E88E5]/20"
                  : "border-white/20 hover:border-white/40"
              )}
              onClick={() => updateSettings("webSearchProvider", "google")}
            >
              Google
            </button>
            <button
              type="button"
              className={clsx(
                "p-2 rounded-lg border-2 transition-all text-center",
                settings.webSearchProvider === "serp"
                  ? "border-[#1E88E5] bg-[#1E88E5]/20"
                  : "border-white/20 hover:border-white/40"
              )}
              onClick={() => updateSettings("webSearchProvider", "serp")}
            >
              SERP
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const advancedSettings = (
    <div className="flex flex-col gap-2">
      <Input
        left={
          <>
            <FaServer />
            <span className="ml-2">{t("endPoint")}</span>
          </>
        }
        disabled={disabled}
        value={settings.customEndPoint || ""}
        onChange={(e) => updateSettings("customEndPoint", e.target.value)}
      />
      <Input
        left={
          <>
            <FaThermometerFull />
            <span className="ml-2">{t("temp")}</span>
          </>
        }
        value={settings.customTemperature || 0.9}
        onChange={(e) =>
          updateSettings("customTemperature", parseFloat(e.target.value))
        }
        type="range"
        toolTipProperties={{
          message: t("temp-tips") as string,
          disabled: false,
        }}
        attributes={{
          min: 0,
          max: 1,
          step: 0.01,
        }}
      />
      <Input
        left={
          <>
            <FaSyncAlt />
            <span className="ml-2">{t("loop")}</span>
          </>
        }
        value={settings.customMaxLoops || 4}
        disabled={disabled}
        onChange={(e) =>
          updateSettings("customMaxLoops", parseFloat(e.target.value))
        }
        type="range"
        toolTipProperties={{
          message: t("loop-tips") as string,
          disabled: false,
        }}
        attributes={{
          min: 1,
          max: 100,
          step: 1,
        }}
      />
      <Input
        left={
          <>
            <FaCoins />
            <span className="ml-2">{t("tokens")}</span>
          </>
        }
        value={settings.customMaxTokens ?? 400}
        disabled={disabled}
        onChange={(e) =>
          updateSettings("customMaxTokens", parseFloat(e.target.value))
        }
        type="range"
        toolTipProperties={{
          message: t("tokens-tips") as string,
          disabled: false,
        }}
        attributes={{
          min: 200,
          max: 2000,
          step: 100,
        }}
      />
    </div>
  );

  return (
    <Dialog
      header={`${t("settings")} ⚙`}
      isShown={show}
      close={close}
      footerButton={
        <>
          <Button className="bg-red-400 hover:bg-red-500" onClick={handleReset}>
            {t("common:reset")}
          </Button>
          <Button onClick={handleSave}>{t("common:save")}</Button>
        </>
      }
    >
      <p>{t("usage")}</p>
      <p className="my-2 text-sm text-yellow-300">
        <FaExclamationCircle className="inline-block" />
        &nbsp;{t("multi-provider-notice")}
      </p>

      <div className="mt-2 flex flex-col gap-2">
        <Accordion
          child={providerSettings}
          name={t("provider-settings")}
        />

        <Accordion
          child={webSearchSettings}
          name={t("web-search-settings")}
        />

        {isGuestMode && (
          <Input
            left={
              <>
                <FaCode />
                <span className="ml-2">{t("guest-key")}</span>
              </>
            }
            value={settings.customGuestKey || ""}
            onChange={(e) => updateSettings("customGuestKey", e.target.value)}
            type="password"
          />
        )}

        <Accordion
          child={advancedSettings}
          name={t("advanced-settings")}
        />
      </div>

      <Trans i18nKey="api-key-notice" ns="settings">
        <strong className="mt-10">
          NOTE: API keys are only used in the current browser session. Choose your preferred provider and model above.
        </strong>
      </Trans>
    </Dialog>
  );
};