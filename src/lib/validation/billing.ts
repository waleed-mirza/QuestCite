import { z } from "zod";

import { PAID_PLAN_CODES } from "@/config/plans";

export const paidPlanSchema = z.enum(PAID_PLAN_CODES);
