import { z } from "zod";

const retentionDaysSchema = z.preprocess(
  (value) => {
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
    return value;
  },
  z.number().int().min(30).max(3650),
);

const checkboxSchema = z.preprocess(
  (value) => {
    if (value === "on" || value === "true" || value === true) return true;
    if (value === "off" || value === "false" || value === false) return false;
    return value;
  },
  z.boolean(),
);

export const workspaceSettingsSchema = z.object({
  retentionDays: retentionDaysSchema,
  aiDraftsDisabled: checkboxSchema,
});

export const deletionConfirmationSchema = z.string().trim().min(1).max(120);
