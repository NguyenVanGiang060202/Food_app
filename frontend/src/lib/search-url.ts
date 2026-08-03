export function updateSearchParam(search: string, key: string, value?: string): string {
  const next = new URLSearchParams(search);
  if (value) next.set(key, value); else next.delete(key);
  const query = next.toString();
  return query ? `/search?${query}` : "/search";
}

export function clearSearchFilters(search: string): string {
  const query = new URLSearchParams(search).get("q")?.trim();
  return query ? `/search?q=${encodeURIComponent(query)}` : "/search";
}

export function readOptionalNumber(value: string | null): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}