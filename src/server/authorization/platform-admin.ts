import "server-only";

import { getServerEnv } from "@/lib/env";
import { getUser, type UserIdentity } from "@/server/auth/session";
import { ForbiddenError, UnauthorizedError } from "@/server/errors";

export function isPlatformAdminEmail(email: string, allowedEmails: readonly string[]): boolean {
  const normalized = email.trim().toLowerCase();
  return normalized !== "" && allowedEmails.some((allowed) => allowed.trim().toLowerCase() === normalized);
}
export async function getPlatformAdmin(): Promise<UserIdentity | null> {
  const user = await getUser();
  if (user === null) return null;
  let allowedEmails: readonly string[] = [];
  try {
    allowedEmails = getServerEnv().PLATFORM_ADMIN_EMAILS ?? [];
  } catch {
    return null;
  }
  return isPlatformAdminEmail(user.email, allowedEmails) ? user : null;
}

export async function requirePlatformAdmin(): Promise<UserIdentity> {
  const user = await getUser();
  if (user === null) throw new UnauthorizedError();
  let allowedEmails: readonly string[] = [];
  try {
    allowedEmails = getServerEnv().PLATFORM_ADMIN_EMAILS ?? [];
  } catch {
    throw new ForbiddenError();
  }
  if (!isPlatformAdminEmail(user.email, allowedEmails)) throw new ForbiddenError();
  return user;
}
