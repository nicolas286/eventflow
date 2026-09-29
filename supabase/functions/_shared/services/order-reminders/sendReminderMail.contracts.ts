import { z } from "zod";
import {
  cronReminderPayloadSchema,
  manualReminderPayloadSchema,
} from "../../../../../shared/schemas/workers.ts";
import { BodyTooLargeError, readLimitedText } from "../../app/request-body.ts";
import { badRequest, ResponseError } from "../../errors.ts";

export type CronReminderPayload = z.infer<typeof cronReminderPayloadSchema>;
export type ManualReminderPayload = z.infer<typeof manualReminderPayloadSchema>;

export type SendReminderMailPayload =
  | {
    kind: "cron";
    data: CronReminderPayload;
  }
  | {
    kind: "manual";
    data: ManualReminderPayload;
  };

export async function parseSendReminderMailPayload(
  req: Request,
): Promise<SendReminderMailPayload> {
  let raw: unknown = { mode: "cron" };

  try {
    const text = await readLimitedText(req, 4096);
    raw = text.trim() ? JSON.parse(text) : { mode: "cron" };
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      throw new ResponseError(413, "PAYLOAD_TOO_LARGE");
    }
    throw badRequest("INVALID_JSON_BODY");
  }

  const mode = raw && typeof raw === "object" && "mode" in raw
    ? (raw as { mode?: unknown }).mode
    : "cron";

  if (mode === "manual") {
    const parsed = manualReminderPayloadSchema.safeParse(raw);

    if (!parsed.success) {
      throw badRequest("INVALID_PAYLOAD", {
        issues: parsed.error.issues,
      });
    }

    return {
      kind: "manual",
      data: parsed.data,
    };
  }

  const parsed = cronReminderPayloadSchema.safeParse(raw ?? { mode: "cron" });

  if (!parsed.success) {
    throw badRequest("INVALID_PAYLOAD", {
      issues: parsed.error.issues,
    });
  }

  return {
    kind: "cron",
    data: parsed.data,
  };
}
