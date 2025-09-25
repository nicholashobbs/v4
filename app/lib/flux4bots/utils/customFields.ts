export function sanitizeCustomFieldLabels(input: unknown, max: number): string[] {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 8;
  const source: unknown[] = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? [input]
      : [];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of source) {
    const trimmed = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= limit) break;
  }

  return result;
}
