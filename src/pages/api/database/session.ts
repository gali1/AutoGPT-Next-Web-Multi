// src/pages/api/database/session.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { Client } from "pg";
import { v4 as uuidv4 } from "uuid";

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

        // Create backup tables with proper error handling
        const createSessionTableQuery = `
            CREATE TABLE IF NOT EXISTS backup_session_data (
                session_token TEXT PRIMARY KEY,
                cookie_id TEXT UNIQUE,
                created_at TIMESTAMP NOT NULL,
                last_accessed TIMESTAMP NOT NULL,
                metadata JSONB
            )
        `;

        const createQueryTableQuery = `
            CREATE TABLE IF NOT EXISTS backup_query_responses (
                id SERIAL PRIMARY KEY,
                session_token TEXT NOT NULL,
                query TEXT NOT NULL,
                response TEXT NOT NULL,
                created_at TIMESTAMP NOT NULL,
                metadata JSONB,
                FOREIGN KEY (session_token) REFERENCES backup_session_data(session_token) ON DELETE CASCADE
            )
        `;

        await pgClient.query(createSessionTableQuery);
        await pgClient.query(createQueryTableQuery);

        await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_backup_session_token ON backup_query_responses(session_token)`);
        await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_backup_created_at ON backup_query_responses(created_at)`);

        console.log("PostgreSQL session backup tables initialized successfully");
        return pgClient;
    } catch (error) {
        console.error("PostgreSQL session initialization failed:", error);
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
                return await handleCreateSession(req, res, client);
            case "GET":
                return await handleGetSession(req, res, client);
            case "PUT":
                return await handleUpdateSession(req, res, client);
            case "DELETE":
                return await handleDeleteSession(req, res, client);
            default:
                return res.status(405).json({ error: "Method not allowed" });
        }
    } catch (error) {
        console.error("Database API error:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
}

async function handleCreateSession(req: NextApiRequest, res: NextApiResponse, client: Client) {
    const { sessionToken, cookieId, metadata = {} } = req.body;

    if (!sessionToken) {
        return res.status(400).json({ error: "Session token required" });
    }

    try {
        const timestamp = new Date();
        const sessionMetadata = {
            ...metadata,
            created_at: timestamp.toISOString(),
            session_info: { token: sessionToken, cookie_id: cookieId },
        };

        await client.query(`
            INSERT INTO backup_session_data (session_token, cookie_id, created_at, last_accessed, metadata)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (session_token)
            DO UPDATE SET cookie_id = $2, last_accessed = $4, metadata = $5
        `, [sessionToken, cookieId || null, timestamp, timestamp, JSON.stringify(sessionMetadata)]);

        return res.status(200).json({ success: true, sessionToken, cookieId });
    } catch (error) {
        console.error("Create session error:", error);
        return res.status(500).json({ error: "Failed to create session" });
    }
}

async function handleGetSession(req: NextApiRequest, res: NextApiResponse, client: Client) {
    const { sessionToken, cookieId } = req.query;

    if (!sessionToken && !cookieId) {
        return res.status(400).json({ error: "Session token or cookie ID required" });
    }

    try {
        let query: string;
        let params: any[];

        if (sessionToken) {
            query = `SELECT * FROM backup_session_data WHERE session_token = $1`;
            params = [sessionToken];
        } else {
            query = `SELECT * FROM backup_session_data WHERE cookie_id = $1`;
            params = [cookieId];
        }

        const result = await client.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        const session = result.rows[0];

        // Get query responses
        const queryResponses = await client.query(
            `SELECT query, response, created_at, metadata FROM backup_query_responses WHERE session_token = $1 ORDER BY created_at ASC`,
            [session.session_token]
        );

        return res.status(200).json({
            session: {
                sessionToken: session.session_token,
                cookieId: session.cookie_id,
                createdAt: session.created_at,
                lastAccessed: session.last_accessed,
                metadata: session.metadata,
            },
            queryResponses: queryResponses.rows.map(row => ({
                query: row.query,
                response: row.response,
                createdAt: row.created_at,
                metadata: row.metadata,
            })),
        });
    } catch (error) {
        console.error("Get session error:", error);
        return res.status(500).json({ error: "Failed to get session" });
    }
}

async function handleUpdateSession(req: NextApiRequest, res: NextApiResponse, client: Client) {
    const { sessionToken, query, response, metadata = {} } = req.body;

    if (!sessionToken || !query || !response) {
        return res.status(400).json({ error: "Session token, query, and response required" });
    }

    try {
        const timestamp = new Date();

        // Enhanced metadata
        const enhancedMetadata = {
            ...metadata,
            timestamp: timestamp.toISOString(),
            type: query.startsWith("Document:") ? "document_analysis" : "chat_completion",
            environment: process.env.NODE_ENV === "production" ? "production" : "development",
        };

        // Insert query response
        await client.query(`
            INSERT INTO backup_query_responses (session_token, query, response, created_at, metadata)
            VALUES ($1, $2, $3, $4, $5)
        `, [sessionToken, query, response, timestamp, JSON.stringify(enhancedMetadata)]);

        // Update session last accessed
        await client.query(`
            UPDATE backup_session_data SET last_accessed = $1 WHERE session_token = $2
        `, [timestamp, sessionToken]);

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Update session error:", error);
        return res.status(500).json({ error: "Failed to update session" });
    }
}

async function handleDeleteSession(req: NextApiRequest, res: NextApiResponse, client: Client) {
    const { sessionToken } = req.query;

    if (!sessionToken) {
        return res.status(400).json({ error: "Session token required" });
    }

    try {
        // Delete query responses first (foreign key constraint)
        await client.query(`DELETE FROM backup_query_responses WHERE session_token = $1`, [sessionToken]);

        // Delete session
        await client.query(`DELETE FROM backup_session_data WHERE session_token = $1`, [sessionToken]);

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error("Delete session error:", error);
        return res.status(500).json({ error: "Failed to delete session" });
    }
}