// src/pages/api/agent/analyze.ts

import type { NextRequest } from "next/server";
import type { RequestBody } from "../../../utils/interfaces";
import AgentService from "../../../services/agent-service";
import { saveQueryResponse } from "../../../utils/database";
import { v4 as uuidv4 } from "uuid";

export const config = {
  runtime: "edge",
};

// Token estimation utility
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Token consumption utility
async function consumeTokensForResponse(sessionToken: string, prompt: string, response: string, metadata: Record<string, any> = {}): Promise<void> {
  if (!sessionToken) return;

  try {
    const estimatedTokens = estimateTokens(prompt + response);

    const consumeResponse = await fetch('/api/tokens/manage', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionToken,
        tokensToConsume: estimatedTokens,
        metadata: {
          ...metadata,
          type: 'agent_analyze',
          promptLength: prompt.length,
          responseLength: response.length,
          timestamp: new Date().toISOString(),
        },
      }),
    });

    if (!consumeResponse.ok) {
      console.warn('Failed to consume tokens:', await consumeResponse.text());
    } else {
      console.log(`Consumed ${estimatedTokens} tokens for analyze task operation`);
    }
  } catch (error) {
    console.warn('Failed to track token consumption:', error);
  }
}

// SSE utilities
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

  const { modelSettings, goal, task, sessionToken } = requestBody;

  if (!task) {
    return new Response(
      encoder.encode(JSON.stringify({ error: "Task is required" })),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(SSEUtils.events.status(encoder, "Analyzing task requirements", { requestId }));
    },

    async pull(controller) {
      try {
        const startTime = Date.now();

        // Send progress updates
        controller.enqueue(SSEUtils.events.status(encoder, "Determining optimal approach for task", { requestId }));

        await new Promise(resolve => setTimeout(resolve, 100)); // Brief delay for UX

        controller.enqueue(SSEUtils.events.status(encoder, "Evaluating if web search is needed", { requestId }));

        // Call agent service
        const analysis = await AgentService.analyzeTaskAgent(
          modelSettings,
          goal,
          task,
          sessionToken
        );

        const processingTime = Date.now() - startTime;

        // Send analysis insight
        if (analysis.action === "search") {
          controller.enqueue(SSEUtils.events.content(encoder, `Analysis complete: Web search required for "${analysis.arg}"`, { requestId }));
        } else {
          controller.enqueue(SSEUtils.events.content(encoder, `Analysis complete: Using reasoning approach for "${analysis.arg}"`, { requestId }));
        }

        // Consume tokens for this operation
        if (sessionToken) {
          const prompt = `Goal: ${goal}, Task: ${task}`;
          const response = JSON.stringify(analysis);
          await consumeTokensForResponse(sessionToken, prompt, response, {
            type: "task_analysis",
            llmProvider: modelSettings.llmProvider,
            processingTime,
            analysis,
            goal,
            requestId
          });
        }

        // Save to database if session token provided
        if (sessionToken) {
          try {
            await saveQueryResponse(
              sessionToken,
              `Task Analysis: ${task}`,
              JSON.stringify(analysis),
              {
                type: "task_analysis",
                llmProvider: modelSettings.llmProvider,
                processingTime,
                analysis,
                goal,
                requestId
              }
            );
          } catch (dbError) {
            console.error("Database save failed:", dbError);
          }
        }

        // Send completion
        controller.enqueue(SSEUtils.events.complete(encoder, {
          response: analysis,
          processingTime,
          action: analysis.action
        }, { requestId }));

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();

      } catch (error) {
        console.error("Task analysis error:", error);

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