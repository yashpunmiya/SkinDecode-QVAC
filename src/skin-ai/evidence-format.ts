type EvidenceRecord = { title?: unknown; source?: unknown; sourceUrl?: unknown };

function record(value: unknown): value is EvidenceRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clean(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim() : undefined;
}

/** Appends references only for evidence actually retrieved from the local catalog. */
export function renderRetrievedCatalogSources(value: unknown): string {
  const evidence = Array.isArray(value) ? value.filter(record).slice(0, 5) : [];
  if (!evidence.length) return '';
  return `\n\nSources\n${evidence.map((item, index) => `• [E${index + 1}] ${clean(item.title) || 'Catalog evidence'} — ${clean(item.source) || 'SkinDecode catalog'}${clean(item.sourceUrl) ? `: ${clean(item.sourceUrl)}` : ''}`).join('\n')}`;
}
