import "server-only";

import { z } from "zod";

import { getServerEnv } from "@/lib/env";
import { logger } from "@/lib/observability/logger";
import type { RenderedEmail } from "@/lib/email/templates";

/**
 * Email abstraction (plan §8/§W6): W6 ships the interface with a LOG-MODE
 * transport — Wiresend/Resend delivery arrives in W8 (no provider account
 * yet, D004). The log transport records the template key and recipient USER
 * id only: never the subject, body, titles, or any content (AGENTS rule 8 /
 * plan §16 log hygiene). A missing address skips delivery — in-app
 * notifications are the durable channel.
 */

export type EmailDelivery = "logged" | "skipped" | "sent" | "failed";

export type OutboundEmail = RenderedEmail & {
  /** Recipient user id — safe to log; the address is not. */
  toUserId: string;
  toEmail: string | null;
  organizationId: string;
};

async function sendViaConfiguredTransport(
  message: RenderedEmail,
  toEmail: string,
  fetchImpl: typeof fetch,
  logContext: { organizationId?: string; toUserId?: string; requestId?: string },
): Promise<EmailDelivery> {
  let env;
  try {
    env = getServerEnv();
  } catch {
    logger.warn("email.configuration_invalid", { code: "EMAIL_CONFIG_INVALID" });
    return "failed";
  }

  if (env.EMAIL_DELIVERY_MODE === "log") {
    if (logContext.requestId === undefined) {
      logger.info("email.log_mode", {
        templateKey: message.templateKey,
        toUserId: logContext.toUserId,
        organizationId: logContext.organizationId,
      });
    } else {
      logger.info("email.prospect_log_mode", {
        templateKey: message.templateKey,
        organizationId: logContext.organizationId,
        requestId: logContext.requestId,
      });
    }
    return "logged";
  }

  const recipient = z.email().safeParse(toEmail.trim());
  if (!recipient.success || env.RESEND_API_KEY === undefined || env.EMAIL_FROM === undefined) {
    logger.warn("email.configuration_invalid", { code: "EMAIL_CONFIG_INVALID" });
    return "failed";
  }

  const resendBody = {
    from: env.EMAIL_FROM,
    to: [recipient.data],
    subject: message.subject,
    text: message.text,
    ...(env.EMAIL_REPLY_TO === undefined ? {} : { reply_to: env.EMAIL_REPLY_TO }),
  };

  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendBody),
    });
    if (!response.ok) {
      logger.warn("email.provider_failed", { status: response.status });
      return "failed";
    }
    return "sent";
  } catch {
    logger.warn("email.network_failed", { code: "EMAIL_PROVIDER_UNAVAILABLE" });
    return "failed";
  }
}

export async function sendEmail(message: OutboundEmail, fetchImpl: typeof fetch = fetch): Promise<EmailDelivery> {
  if (message.toEmail === null || message.toEmail.trim() === "") {
    return "skipped";
  }
  return sendViaConfiguredTransport(message, message.toEmail, fetchImpl, {
    organizationId: message.organizationId,
    toUserId: message.toUserId,
  });
}

/**
 * Prospect-facing variant (plan §W7): the recipient is an anonymous visitor
 * with no user id. The log transport records the template key and the access
 * REQUEST id only — never the prospect's address, name, or the access link
 * (the link carries the raw bearer token; AGENTS rule 8).
 */
export type OutboundProspectEmail = RenderedEmail & {
  organizationId?: string;
  requestId: string;
  toEmail: string | null;
};

export async function sendProspectEmail(
  message: OutboundProspectEmail,
  fetchImpl: typeof fetch = fetch,
): Promise<EmailDelivery> {
  if (message.toEmail === null || message.toEmail.trim() === "") {
    return "skipped";
  }
  const logContext: { organizationId?: string; requestId?: string } = { requestId: message.requestId };
  if (message.organizationId !== undefined) logContext.organizationId = message.organizationId;
  return sendViaConfiguredTransport(message, message.toEmail, fetchImpl, logContext);
}
