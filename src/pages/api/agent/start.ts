// src/pages/api/agent/start.ts

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { RequestBody } from "../../../utils/interfaces";
import AgentService from "../../../services/agent-service";
import { saveQueryResponse } from "../../../utils/database";
import { v4 as uuidv4 } from "uuid";

export const config = {
  runtime: "edge",
};

// SSE utilities optimized for production
const SSEUtils = {
  setupSSE: (response: Response) => {
    const headers = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return headers;
  },

  sendEvent: (encoder: TextEncoder, data: any): Uint8Array => {
    const jsonData = typeof data === 'string' ? data : JSON.stringify(data);
    return encoder.encode(`data: ${jsonData}\n\n`);
  },

  sendTypedEvent: (encoder: TextEncoder, type: string, data: any): Uint8Array => {
    const event = { ...data, type, timestamp: new Date().toISOString() };
    return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  },

  events: {
    content: (encoder: TextEncoder, content: string, meta = {}) => {
      return SSEUtils.sendTypedEvent(encoder, "content", { content, ...meta });
    },
    error: (encoder: TextEncoder, error: string | Error, meta = {}) => {
      const errorObj = {
        error: typeof error === 'string' ? error : error.message || "Unknown error",
        ...meta
      };
      return SSEUtils.sendTypedEvent(encoder, "error", errorObj);
    },
    status: (encoder: TextEncoder, message: string, meta = {}) => {
      return SSEUtils.sendTypedEvent(encoder, "status", { message, ...meta });
    },
    complete: (encoder: TextEncoder, result: any, meta = {}) => {
      return SSEUtils.sendTypedEvent(encoder, "complete", { result, ...meta });
    },
  }
};

const handler = async (request: NextRequest) => {
  const requestId = uuidv4().substring(0, 8);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: SSEUtils.setupSSE(new Response()) });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const encoder = new TextEncoder();
  const headers = SSEUtils.setupSSE(new Response());

  let requestBody: RequestBody;
  try {
    requestBody = await request.json() as RequestBody;
  } catch (error) {
    return new Response(
      encoder.encode(JSON.stringify({ error: "Invalid JSON in request body" })),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { modelSettings, goal, customLanguage, sessionToken } = requestBody;

  if (!goal) {
    return new Response(
      encoder.encode(JSON.stringify({ error: "Goal is required" })),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const stream = new ReadableStream({
    start(controller) {
      // Send initial status
      controller.enqueue(SSEUtils.events.status(encoder, "Starting goal analysis", { requestId }));
    },

    async pull(controller) {
      try {
        // Send status update
        controller.enqueue(SSEUtils.events.status(encoder, "Analyzing goal and creating initial tasks", { requestId }));

        const startTime = Date.now();

        // Call agent service
        const newTasks = await AgentService.startGoalAgent(
          modelSettings,
          goal,
          customLanguage
        );

        const processingTime = Date.now() - startTime;

        // Save to database if session token provided
        if (sessionToken) {
          try {
            await saveQueryResponse(
              sessionToken,
              `Goal: ${goal}`,
              JSON.stringify(newTasks),
              {
                type: "goal_creation",
                llmProvider: modelSettings.llmProvider,
                processingTime,
                taskCount: newTasks.length,
                requestId
              }
            );
          } catch (dbError) {
            console.error("Database save failed:", dbError);
            // Continue without failing the request
          }
        }

        // Send completion with results
        controller.enqueue(SSEUtils.events.complete(encoder, {
          newTasks,
          processingTime,
          taskCount: newTasks.length
        }, { requestId }));

        // Close stream
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();

      } catch (error) {
        console.error("Agent start error:", error);

        const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
        controller.enqueue(SSEUtils.events.error(encoder, errorMessage, { requestId }));

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers });
};

export default handler;