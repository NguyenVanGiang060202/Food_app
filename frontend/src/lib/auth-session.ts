import type { LocalUser } from "../hooks/auth-storage.ts";

export async function readSessionResponse(response: Pick<Response, "ok" | "status" | "json">): Promise<LocalUser | null> {
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error("Session request failed");

  const result = await response.json() as { user?: LocalUser | null };
  return result.user ?? null;
}