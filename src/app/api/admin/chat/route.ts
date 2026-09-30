import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAdminSession } from "@/lib/admin-auth";
import { apiKeyProblem, CHAT_LIMITS, chatConfig } from "@/lib/admin-chat/config";
import {
  checkMessage,
  clientKeyFrom,
  isLocked,
  lockRemaining,
  utcDayStart,
} from "@/lib/admin-chat/guard";
import { dateBlock, systemPrompt } from "@/lib/admin-chat/prompt";
import { checkChatRateLimit } from "@/lib/admin-chat/rate-limit";
import { runTool, toolDefinitions, type ToolContext } from "@/lib/admin-chat/tools";
import { describeApiError } from "@/lib/admin-chat/api-error";
import { loadChatSettings } from "@/lib/admin-chat/settings";
import { effectiveModel } from "@/lib/admin-chat/settings-rules";

/**
 * POST /api/admin/chat — one turn of the admin assistant.
 *
 * Body: `{ conversationId?: string, message: string }`.
 * Answers with NDJSON, one event per line:
 *   { type: "conversation", id }        the conversation this turn belongs to
 *   { type: "status", text }            a tool is running ("Looking up the order…")
 *   { type: "text", delta }             streamed answer text
 *   { type: "handoff", assignee }       escalate_to_human ran
 *   { type: "locked", message }         the 3rd strike locked the chat
 *   { type: "done" } | { type: "error", message }
 *
 * Every refusal that can be decided before the model runs (disabled, not an
 * admin, rate limit, daily cap, lock, turn cap, bad input) is a plain JSON
 * error with a status code, so the client never opens a stream just to be told no.
 */

export const runtime = "nodejs";
export const maxDuration = 120;

const STATUS_TEXT: Record<string, string> = {
  search_orders: "Searching orders…",
  get_order: "Reading the order…",
  explain_error_code: "Looking up the error…",
  list_plans: "Checking plans…",
  order_stats: "Crunching the numbers…",
  live_jobs: "Checking running jobs…",
  list_image_pools: "Checking the image pools…",
  escalate_to_human: "Handing off…",
  flag_off_topic: "…",
};

function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: Request) {
  const cfg = chatConfig();
  // Disabled reads as absent: a testing feature should not advertise itself.
  if (!cfg.enabled) return refuse(404, "Not found");
  if (!(await verifyAdminSession())) return refuse(401, "Your admin session has expired. Log in again.");
  const keyProblem = apiKeyProblem(cfg.apiKey);
  if (keyProblem) return refuse(503, `The assistant is not configured: ${keyProblem}`);

  let body: { conversationId?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return refuse(400, "Bad request.");
  }
  const check = checkMessage(body.message);
  if (!check.ok) return refuse(400, check.error);

  const clientKey = clientKeyFrom(req.headers);
  const rl = await checkChatRateLimit(clientKey);
  if (!rl.ok) return refuse(429, "Too many questions in a short time. Wait a few minutes and try again.");

  const today = await prisma.adminChatMessage.count({
    where: { role: "user", createdAt: { gte: utcDayStart() } },
  });
  if (today >= cfg.dailyLimit) {
    return refuse(429, `The assistant's daily limit (${cfg.dailyLimit} questions) is used up. It resets at 08:00 Malaysia time.`);
  }

  const now = new Date();
  let conversation =
    typeof body.conversationId === "string"
      ? await prisma.adminChatConversation.findUnique({ where: { id: body.conversationId } })
      : null;
  if (!conversation) {
    // A new conversation must not be a way out of a lock.
    const locked = await prisma.adminChatConversation.findFirst({
      where: { clientKey, lockedUntil: { gt: now } },
      orderBy: { lockedUntil: "desc" },
      select: { lockedUntil: true },
    });
    if (locked?.lockedUntil) {
      return refuse(423, `The assistant is locked after repeated off-topic requests. Try again ${lockRemaining(locked.lockedUntil, now)}.`);
    }
    conversation = await prisma.adminChatConversation.create({ data: { clientKey } });
  }
  if (isLocked(conversation.lockedUntil, now)) {
    return refuse(423, `The assistant is locked after repeated off-topic requests. Try again ${lockRemaining(conversation.lockedUntil!, now)}.`);
  }

  const prior = await prisma.adminChatMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: CHAT_LIMITS.historyTurns * 2,
    select: { role: true, content: true },
  });
  const userTurns = await prisma.adminChatMessage.count({
    where: { conversationId: conversation.id, role: "user" },
  });
  if (userTurns >= CHAT_LIMITS.maxUserTurns) {
    return refuse(400, "This conversation is at its limit. Start a new chat.");
  }

  await prisma.adminChatMessage.create({
    data: { conversationId: conversation.id, role: "user", content: check.text },
  });

  // Replayed as plain text: no thinking or tool blocks, so there is nothing
  // for a later turn to invalidate. The API needs alternating roles starting
  // with user, so an orphaned leading assistant row (history cut) is dropped.
  const history = prior.reverse().filter((m) => m.role === "user" || m.role === "assistant");
  while (history.length && history[0].role !== "user") history.shift();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: check.text },
  ];

  // Read on every turn, so a save on /admin/assistant applies to the next
  // message without a deploy.
  const settings = await loadChatSettings();
  const { model, effort } = effectiveModel(settings, cfg);

  const conversationId = conversation.id;
  const ctx: ToolContext = {
    conversationId,
    handoffName: cfg.handoffName,
    handoffEmail: cfg.handoffEmail,
    events: {},
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // The browser went away; the turn still finishes and is saved.
        }
      };
      let handoffSent = false;

      let answer = "";
      let inputTokens = 0;
      let outputTokens = 0;
      const toolLog: { name: string; input: unknown; isError: boolean }[] = [];

      send({ type: "conversation", id: conversationId });

      try {
        // Explicit key, and no auth token: left to itself the SDK also reads
        // ANTHROPIC_AUTH_TOKEN and sends it beside the key.
        const client = new Anthropic({ apiKey: cfg.apiKey, authToken: null });
        const tools = toolDefinitions(settings);
        const system: Anthropic.Beta.BetaTextBlockParam[] = [
          // Tools render before system, so this one breakpoint caches both.
          {
            type: "text",
            text: systemPrompt(cfg.handoffName, settings.instructions),
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: dateBlock(now) },
        ];

        let finished = false;
        for (let call = 0; call < CHAT_LIMITS.maxModelCalls && !finished; call++) {
          const turn = client.beta.messages.stream(
            {
              model,
              max_tokens: 16000,
              system,
              // Every tool switched off: send none rather than an empty list.
              ...(tools.length ? { tools } : {}),
              messages,
              output_config: { effort },
              // Server-side refusal fallback: a safety-classifier decline is
              // retried on the model the API picks for that category.
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default",
            },
            { signal: req.signal },
          );
          turn.on("text", (delta) => {
            answer += delta;
            send({ type: "text", delta });
          });
          const msg = await turn.finalMessage();
          inputTokens += msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0);
          outputTokens += msg.usage.output_tokens;

          if (msg.stop_reason === "refusal") {
            const note = "\n\nI can't help with that one.";
            answer += note;
            send({ type: "text", delta: note });
            break;
          }
          const uses = msg.content.filter(
            (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
          );
          if (uses.length === 0) {
            finished = true;
            break;
          }
          if (msg.stop_reason === "max_tokens") {
            // A tool input cut off mid-way is never run.
            const note = "\n\n(The answer ran too long. Ask a narrower question.)";
            answer += note;
            send({ type: "text", delta: note });
            break;
          }

          messages.push({ role: "assistant", content: msg.content });
          for (const u of uses) {
            if (STATUS_TEXT[u.name] && u.name !== "flag_off_topic") {
              send({ type: "status", text: STATUS_TEXT[u.name] });
            }
          }
          // All results go back in ONE user message, as parallel calls require.
          const results = await Promise.all(
            uses.map(async (u) => {
              const r = await runTool(u.name, u.input, ctx, settings.disabledTools);
              toolLog.push({ name: u.name, input: u.input, isError: r.isError });
              return {
                type: "tool_result" as const,
                tool_use_id: u.id,
                content: r.content,
                ...(r.isError ? { is_error: true } : {}),
              };
            }),
          );
          messages.push({ role: "user", content: results });
          if (ctx.events.escalationId && !handoffSent) {
            handoffSent = true;
            send({ type: "handoff", assignee: cfg.handoffName });
          }
        }

        if (!finished && !answer.trim()) {
          const note = "I couldn't finish looking that up. Try a narrower question.";
          answer = note;
          send({ type: "text", delta: note });
        }
        if (ctx.events.locked) {
          send({
            type: "locked",
            message: `The assistant is locked for an hour after repeated off-topic requests.`,
          });
        }
        send({ type: "done" });
      } catch (e) {
        if (!req.signal.aborted) {
          console.error(
            "[admin-chat] turn failed:",
            e instanceof Anthropic.APIError ? describeApiError(e) : e,
          );
          // Every API failure carries the API's own reason; the prefix only
          // says which of our settings to look at first.
          const message =
            e instanceof Anthropic.AuthenticationError
              ? `The assistant's API key was rejected. ${describeApiError(e)}`
              : e instanceof Anthropic.RateLimitError
                ? `The AI service is busy; try again in a minute. ${describeApiError(e)}`
                : e instanceof Anthropic.APIError
                  ? describeApiError(e)
                  : "Something went wrong. Try again.";
          send({ type: "error", message });
        }
      } finally {
        // Saved even on failure, so a half-answered turn is still reviewable.
        await prisma.adminChatMessage
          .create({
            data: {
              conversationId,
              role: "assistant",
              content: answer.trim() || "(no answer)",
              toolCalls: toolLog.length ? (toolLog as object[]) : undefined,
              inputTokens,
              outputTokens,
            },
          })
          .catch((err) => console.error("[admin-chat] could not save the reply:", err));
        try {
          controller.close();
        } catch {
          // Already closed by a client disconnect.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
