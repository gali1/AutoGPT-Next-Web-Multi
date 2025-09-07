// src/utils/logger.ts

// ANSI color codes for logging
const COLORS = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    underscore: "\x1b[4m",
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
};

const LOG_LEVELS = {
    debug: { color: COLORS.cyan, symbol: "🔍" },
    info: { color: COLORS.green, symbol: "ℹ️" },
    warn: { color: COLORS.yellow, symbol: "⚠️" },
    error: { color: COLORS.red, symbol: "❌" },
    stream: { color: COLORS.blue, symbol: "📡" },
    cache: { color: COLORS.magenta, symbol: "📦" },
    db: { color: COLORS.yellow, symbol: "💾" },
    search: { color: COLORS.cyan, symbol: "🔎" },
    token: { color: COLORS.green, symbol: "🪙" },
    api: { color: COLORS.blue, symbol: "🌐" },
    llm: { color: COLORS.magenta, symbol: "🤖" },
    task: { color: COLORS.yellow, symbol: "📋" },
};

// Enhanced Logger class with detailed API tracking
class Logger {
    constructor(options = {}) {
        this.options = {
            showTimestamp: true,
            showLevel: true,
            showFile: true,
            minLevel: "debug",
            ...options,
        };

        this.recentMessages = new Map();
        this.throttleWindow = options.throttleWindow || 60000;
        this.lastUserActivity = Date.now();
        this.isUserActive = false;
        this.activityTimeout = options.activityTimeout || 5 * 60 * 1000;
        this.requestTracking = new Map(); // Track ongoing requests
    }

    recordUserActivity() {
        this.lastUserActivity = Date.now();
        this.isUserActive = true;

        clearTimeout(this._activityTimer);
        this._activityTimer = setTimeout(() => {
            this.isUserActive = false;
        }, this.activityTimeout);
    }

    isThrottled(level, message, meta = {}) {
        const contextKey = `${level}:${message}:${meta.sessionToken || ''}`;
        const now = Date.now();

        if (this.recentMessages.has(contextKey)) {
            const lastTime = this.recentMessages.get(contextKey);
            if (now - lastTime < this.throttleWindow) {
                return true;
            }
        }

        this.recentMessages.set(contextKey, now);

        if (this.recentMessages.size > 1000) {
            for (const [key, time] of this.recentMessages.entries()) {
                if (now - time > this.throttleWindow) {
                    this.recentMessages.delete(key);
                }
            }
        }

        return false;
    }

    formatMessage(level, message, meta = {}) {
        const parts = [];
        const timestamp = new Date().toISOString();
        const levelConfig = LOG_LEVELS[level] || LOG_LEVELS.info;

        if (this.options.showTimestamp) {
            parts.push(`${COLORS.dim}[${timestamp}]${COLORS.reset}`);
        }

        parts.push(
            `${levelConfig.color}${levelConfig.symbol} ${level.toUpperCase()}${COLORS.reset}`
        );

        if (meta.requestId) {
            parts.push(`${COLORS.cyan}[REQ:${meta.requestId.substring(0, 8)}]${COLORS.reset}`);
        }

        if (meta.sessionToken) {
            parts.push(
                `${COLORS.yellow}[SESSION:${meta.sessionToken.substring(0, 8)}...]${COLORS.reset}`
            );
        }

        if (meta.provider) {
            parts.push(`${COLORS.magenta}[${meta.provider.toUpperCase()}]${COLORS.reset}`);
        }

        if (meta.model) {
            parts.push(`${COLORS.blue}[${meta.model}]${COLORS.reset}`);
        }

        if (meta.url) {
            const urlParts = meta.url.split('/');
            const endpoint = urlParts.slice(-2).join('/');
            parts.push(`${COLORS.cyan}[${endpoint}]${COLORS.reset}`);
        }

        if (meta.method) {
            parts.push(`${COLORS.green}[${meta.method}]${COLORS.reset}`);
        }

        if (meta.status) {
            const statusColor = meta.status >= 400 ? COLORS.red :
                meta.status >= 300 ? COLORS.yellow : COLORS.green;
            parts.push(`${statusColor}[${meta.status}]${COLORS.reset}`);
        }

        if (meta.duration) {
            parts.push(`${COLORS.dim}[${meta.duration}ms]${COLORS.reset}`);
        }

        if (meta.tokens) {
            parts.push(`${COLORS.green}[${meta.tokens}🪙]${COLORS.reset}`);
        }

        if (meta.streamChunk) {
            parts.push(`${COLORS.blue}[CHUNK:${meta.streamChunk}]${COLORS.reset}`);
        }

        parts.push(`${levelConfig.color}${message}${COLORS.reset}`);

        const extraMeta = { ...meta };
        delete extraMeta.requestId;
        delete extraMeta.sessionToken;
        delete extraMeta.streamChunk;
        delete extraMeta.provider;
        delete extraMeta.model;
        delete extraMeta.url;
        delete extraMeta.method;
        delete extraMeta.status;
        delete extraMeta.duration;
        delete extraMeta.tokens;

        if (Object.keys(extraMeta).length > 0) {
            parts.push(`${COLORS.dim}${JSON.stringify(extraMeta, null, 0)}${COLORS.reset}`);
        }

        return parts.join(" ");
    }

    log(level, message, meta = {}) {
        if (!meta.forceLog && !this.isUserActive && !meta.requestId &&
            level !== "error" && level !== "warn" &&
            (message.includes("already exists") ||
                message.includes("health check") ||
                message.includes("sync") ||
                message.includes("cleanup"))) {
            return;
        }

        if (this.isThrottled(level, message, meta)) {
            return;
        }

        const formattedMessage = this.formatMessage(level, message, meta);
        console.log(formattedMessage);
    }

    // Start tracking a request
    startRequest(requestId, meta = {}) {
        this.requestTracking.set(requestId, {
            startTime: Date.now(),
            ...meta
        });

        this.api(`Request started`, {
            requestId,
            ...meta
        });
    }

    // End tracking a request
    endRequest(requestId, meta = {}) {
        const tracking = this.requestTracking.get(requestId);
        if (tracking) {
            const duration = Date.now() - tracking.startTime;
            this.requestTracking.delete(requestId);

            this.api(`Request completed`, {
                requestId,
                duration,
                ...meta
            });
        }
    }

    // Log URL construction details
    urlConstruction(message, meta = {}) {
        this.debug(`URL Construction: ${message}`, {
            ...meta,
            component: 'url-builder'
        });
    }

    // Log token operations
    tokenOperation(operation, meta = {}) {
        this.token(`Token ${operation}`, meta);
    }

    // Log API calls with detailed info
    apiCall(method, url, meta = {}) {
        this.api(`${method} ${url}`, {
            method,
            url,
            ...meta
        });
    }

    // Log LLM interactions
    llmInteraction(provider, model, operation, meta = {}) {
        this.llm(`${provider}/${model} ${operation}`, {
            provider,
            model,
            operation,
            ...meta
        });
    }

    // Log task operations
    taskOperation(operation, taskId, meta = {}) {
        this.task(`Task ${operation}: ${taskId?.substring(0, 8) || 'unknown'}`, {
            taskId,
            operation,
            ...meta
        });
    }

    debug(message, meta = {}) {
        this.log("debug", message, meta);
    }
    info(message, meta = {}) {
        this.log("info", message, meta);
    }
    warn(message, meta = {}) {
        this.log("warn", message, meta);
    }
    error(message, meta = {}) {
        this.log("error", message, meta);
    }
    stream(message, meta = {}) {
        this.log("stream", message, meta);
    }
    cache(message, meta = {}) {
        this.log("cache", message, meta);
    }
    db(message, meta = {}) {
        this.log("db", message, meta);
    }
    search(message, meta = {}) {
        this.log("search", message, meta);
    }
    token(message, meta = {}) {
        this.log("token", message, meta);
    }
    api(message, meta = {}) {
        this.log("api", message, meta);
    }
    llm(message, meta = {}) {
        this.log("llm", message, meta);
    }
    task(message, meta = {}) {
        this.log("task", message, meta);
    }
}

// Initialize and export logger
export const logger = new Logger();

// Helper function to get current time context
export function getCurrentTimeContext() {
    const now = new Date();

    return {
        time: now.toLocaleTimeString('en-US', {
            hour12: true,
            timeZone: 'UTC',
            hour: '2-digit',
            minute: '2-digit'
        }),
        dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
        fullDate: now.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }),
        year: now.getFullYear(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timestamp: now.toISOString(),
        unixTimestamp: Math.floor(now.getTime() / 1000)
    };
}

// Helper function to format time context for prompts
export function getTimeContextPrompt() {
    const timeContext = getCurrentTimeContext();

    return `CURRENT TIME VALUES:
TIME: ${timeContext.time} UTC
DAY: ${timeContext.dayOfWeek}
DATE: ${timeContext.fullDate}
YEAR: ${timeContext.year}
TIMEZONE: ${timeContext.timezone}
TIMESTAMP: ${timeContext.timestamp}

NOTE: Use this current date/time information in your responses. The current year is ${timeContext.year}, not 2023 or earlier.`;
}

export default logger;