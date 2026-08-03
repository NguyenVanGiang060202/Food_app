export function buildCleanAuthPath(returnTo: string, resetToken?: string): string {
  const params = new URLSearchParams();
  const safeReturnTo = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/saved";

  if (safeReturnTo !== "/saved") params.set("returnTo", safeReturnTo);
  if (resetToken) params.set("resetToken", resetToken);

  const query = params.toString();
  return query ? `/auth?${query}` : "/auth";
}