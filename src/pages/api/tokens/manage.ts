// src/pages/api/tokens/manage.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { Client } from "pg";
import { v4 as uuidv4 } from "uuid";
import { DEMO_TOKEN_LIMIT, TOKEN_RESET_HOURS } from "../../../utils/constants";

let pgClient: Client | null = null;

async function initializePostgreSQL() {
    if (pgClient) return pgClient;

    try {
        const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
        if (!connectionString) {
            console.warn("No PostgreSQL connection string found");
            return null;
        }

        pgClient = new Client({ connectionString });
        await pgClient.connect();

        // Create token tracking table with proper string interpolation
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS demo_tokens (
                id SERIAL PRIMARY KEY,
                session_token TEXT NOT NULL,
                cookie_id TEXT,
                tokens_used INTEGER DEFAULT 0,
                tokens_remaining INTEGER DEFAULT ${DEMO_TOKEN_LIMIT},
                first_access TIMESTAMP DEFAULT NOW(),
                last_activity TIMESTAMP DEFAULT NOW(),
                reset_at TIMESTAMP DEFAULT (NOW() + INTERVAL '${TOKEN_RESET_HOURS} hours'),
                user_agent TEXT,
                ip_address TEXT,
                metadata JSONB,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(session_token)
            )
        `;

        await pgClient.query(createTableQuery);

        await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_demo_tokens_session ON demo_tokens(session_token)`);
        await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_demo_tokens_cookie ON demo_tokens(cookie_id)`);
        await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_demo_tokens_reset ON demo_tokens(reset_at)`);

        console.log("PostgreSQL token management tables initialized successfully");
        return pgClient;
    } catch (error) {
        console.error("PostgreSQL token management initialization failed:", error);
        pgClient = null;
        return null;
    }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        return res.status(200).end();
    }

    try {
        const client = await initializePostgreSQL();

        if (!client) {
            return res.status(500).json({ error: "Database connection failed" });
        }

        switch (req.method) {
            case "POST":
                return await handleInitializeTokens(req, res, client);
            case "GET":
                return await handleGetTokenStatus(req, res, client);
            case "PUT":
                return await handleConsumeTokens(req, res, client);
            case "DELETE":
                return await handleResetTokens(req, res, client);
            default:
                return res.status(405).json({ error: "Method not allowed" });
        }
    } catch (error) {
        console.error("Token management API error:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
}

async function handleInitializeTokens(req: NextApiRequest, res: NextApiResponse, client: Client) {
    const { sessionToken, cookieId, userAgent, ipAddress, metadata = {} } = req.body;

    if (!sessionToken) {
        return res.status(400).json({ error: "Session token required" });
    }

    try {
        // Check if user already exists
        const existing = await client.query(
            `SELECT * FROM demo_tokens WHERE session_token = $1 OR (cookie_id IS NOT NULL AND cookie_id = $2)`,
            [sessionToken, cookieId]
        );

        if (existing.rows.length > 0) {
            const user = existing.rows[0];

            // Check if tokens need reset
            const now = new Date();
            const resetAt = new Date(user.reset_at);

            if (now > resetAt) {
                // Reset tokens
                const newResetAt = new Date(now.getTime() + TOKEN_RESET_HOURS * 60 * 60 * 1000);

                await client.query(`
                    UPDATE demo_tokens
                    SET tokens_used = 0,
                        tokens_remaining = $1,
                        last_activity = NOW(),
                        reset_at = $2,
                        session_token = $3,
                        cookie_id = $4
                    WHERE id = $5
                `, [DEMO_TOKEN_LIMIT, newResetAt, sessionToken, cookieId, user.id]);

                return res.status(200).json({
                    tokensUsed: 0,
                    tokensRemaining: DEMO_TOKEN_LIMIT,
                    resetAt: newResetAt.toISOString(),
                    isReset: true
                });
            } else {
                // Update activity
                await client.query(`
                    UPDATE demo_tokens
                    SET last_activity = NOW(),
                        session_token = $1,
                        cookie_id = $2
                    WHERE id = $3
                `, [sessionToken, cookieId, user.id]);

                return res.status(200).json({
                    tokensUsed: user.tokens_used,
                    tokensRemaining: user.tokens_remaining,
                    resetAt: user.reset_at,
                    isExisting: true
                });
            }
        }

        // Create new user
        const resetAt = new Date(Date.now() + TOKEN_RESET_HOURS * 60 * 60 * 1000);

        const result = await client.query(`
            INSERT INTO demo_tokens (session_token, cookie_id, user_agent, ip_address, metadata, reset_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING tokens_used, tokens_remaining, reset_at
        `, [sessionToken, cookieId, userAgent, ipAddress, JSON.stringify(metadata), resetAt]);

        const newUser = result.rows[0];

        return res.status(200).json({
            tokensUsed: newUser.tokens_used,
            tokensRemaining: newUser.tokens_remaining,
            resetAt: newUser.reset_at,
            isNew: true
        });
    } catch (error) {
        console.error("Initialize tokens error:", error);
        return res.status(500).json({ error: "Failed to initialize tokens" });
    }
}

async function handleGetTokenStatus(req: NextApiRequest, res: NextApiResponse, client: Client) {
    const { sessionToken, cookieId } = req.query;

    if (!sessionToken && !cookieId) {
        return res.status(400).json({ error: "Session token or cookie ID required" });
    }

    try {
        let query: string;
        let params: any[];

        if (sessionToken) {
            query = `SELECT * FROM demo_tokens WHERE session_token = $1`;
            params = [sessionToken];
        } else {
            query = `SELECT * FROM demo_tokens WHERE cookie_id = $1`;
            params = [cookieId];
        }

        const result = await client.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Token record not found" });
        }

        const user = result.rows[0];
        const now = new Date();
        const resetAt = new Date(user.reset_at);

        // Check if tokens should be reset
        if (now > resetAt) {
            const newResetAt = new Date(now.getTime() + TOKEN_RESET_HOURS * 60 * 60 * 1000);

            await client.query(`
                UPDATE demo_tokens
                SET tokens_used = 0,
                    tokens_remaining = $1,
                    last_activity = NOW(),
                    reset_at = $2
                WHERE id = $3
            `, [DEMO_TOKEN_LIMIT, newResetAt, user.id]);

            return res.status(200).json({
                tokensUsed: 0,
                tokensRemaining: DEMO_TOKEN_LIMIT,
                resetAt: newResetAt.toISOString(),
                timeUntilReset: TOKEN_RESET_HOURS * 60 * 60 * 1000,
                canUseTokens: true
            });
        }

        const timeUntilReset = resetAt.getTime() - now.getTime();

        return res.status(200).json({
            tokensUsed: user.tokens_used,
            tokensRemaining: user.tokens_remaining,
            resetAt: user.reset_at,
            timeUntilReset,
            canUseTokens: user.tokens_remaining > 0
        });
    } catch (error) {
        console.error("Get token status error:", error);
        return res.status(500).json({ error: "Failed to get token status" });
    }
}

async function handleConsumeTokens(req: NextApiRequest, res: NextApiResponse, client: Client) {
    const { sessionToken, tokensToConsume, metadata = {} } = req.body;

    if (!sessionToken || !tokensToConsume) {
        return res.status(400).json({ error: "Session token and tokens to consume required" });
    }

    try {
        // Get current status
        const result = await client.query(
            `SELECT * FROM demo_tokens WHERE session_token = $1`,
            [sessionToken]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Token record not found" });
        }

        const user = result.rows[0];
        const now = new Date();
        const resetAt = new Date(user.reset_at);

        // Check if tokens should be reset
        if (now > resetAt) {
            const newResetAt = new Date(now.getTime() + TOKEN_RESET_HOURS * 60 * 60 * 1000);

            await client.query(`
                UPDATE demo_tokens
                SET tokens_used = 0,
                    tokens_remaining = $1,
                    last_activity = NOW(),
                    reset_at = $2
                WHERE id = $3
            `, [DEMO_TOKEN_LIMIT, newResetAt, user.id]);

            // Use updated values
            user.tokens_used = 0;
            user.tokens_remaining = DEMO_TOKEN_LIMIT;
        }

        // Check if user has enough tokens
        if (user.tokens_remaining < tokensToConsume) {
            return res.status(403).json({
                error: "Insufficient tokens",
                tokensRemaining: user.tokens_remaining,
                tokensRequested: tokensToConsume
            });
        }

        // Consume tokens
        const newUsed = user.tokens_used + tokensToConsume;
        const newRemaining = user.tokens_remaining - tokensToConsume;

        // Update activity time for reset calculation
        const newResetAt = new Date(now.getTime() + TOKEN_RESET_HOURS * 60 * 60 * 1000);

        await client.query(`
            UPDATE demo_tokens
            SET tokens_used = $1,
                tokens_remaining = $2,
                last_activity = NOW(),
                reset_at = $3,
                metadata = jsonb_set(COALESCE(metadata, '{}'), '{last_consumption}', $4)
            WHERE id = $5
        `, [newUsed, newRemaining, newResetAt, JSON.stringify({
            ...metadata,
            timestamp: now.toISOString(),
            tokensConsumed: tokensToConsume
        }), user.id]);

        return res.status(200).json({
            tokensUsed: newUsed,
            tokensRemaining: newRemaining,
            tokensConsumed: tokensToConsume,
            resetAt: newResetAt.toISOString(),
            success: true
        });
    } catch (error) {
        console.error("Consume tokens error:", error);
        return res.status(500).json({ error: "Failed to consume tokens" });
    }
}

async function handleResetTokens(req: NextApiRequest, res: NextApiResponse, client: Client) {
    const { sessionToken } = req.query;

    if (!sessionToken) {
        return res.status(400).json({ error: "Session token required" });
    }

    try {
        const now = new Date();
        const resetAt = new Date(now.getTime() + TOKEN_RESET_HOURS * 60 * 60 * 1000);

        await client.query(`
            UPDATE demo_tokens
            SET tokens_used = 0,
                tokens_remaining = $1,
                last_activity = NOW(),
                reset_at = $2
            WHERE session_token = $3
        `, [DEMO_TOKEN_LIMIT, resetAt, sessionToken]);

        return res.status(200).json({
            tokensUsed: 0,
            tokensRemaining: DEMO_TOKEN_LIMIT,
            resetAt: resetAt.toISOString(),
            success: true
        });
    } catch (error) {
        console.error("Reset tokens error:", error);
        return res.status(500).json({ error: "Failed to reset tokens" });
    }
}