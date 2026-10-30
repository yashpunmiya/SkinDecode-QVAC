const GENERIC_LABELS = new Set(['private app notes for this question (use only what is relevant; do not describe these notes):']);

function priority(line: string, question: string) {
  const value = line.toLocaleLowerCase();
  const asksProduct = /product|ingredient|formula|compare|cleanser|face ?wash|routine|shelf/.test(question);
  const asksRoutine = /routine|steps|used|using|skip|completed|morning|evening|tonight|am|pm/.test(question);
  const asksChecks = /skin|rating|check|trend|worse|better|today|yesterday|irrit|redness|dryness|breakout/.test(question);
  const asksWater = /water|glasses|intake|drink/.test(question);
  if (value.startsWith('data limitation:')) return 0;
  if (value.startsWith('skin profile')) return 1;
  if (value.startsWith('[e') && asksProduct) return 2;
  if (/^selected product|^product formula|^locally cached product/.test(value) && asksProduct) return 2;
  if (asksProduct && /listed ingredients|app formula findings|app skin match|catalog formula evidence/.test(value)) return 2;
  if (value.startsWith('routine') && asksRoutine) return 2;
  if (/skin check|check-in comparison|recorded yesterday-to-today|skin ratings/.test(value) && asksChecks) return 2;
  if (/water intake|water records/.test(value) && asksWater) return 2;
  if (value.startsWith('products on shelf') && asksProduct) return 3;
  if (asksRoutine && /routine|formula|ingredient|product/.test(value)) return 3;
  if (asksChecks && /skin|rating|check|new product/.test(value)) return 3;
  if (asksWater && /water|glass/.test(value)) return 3;
  return 5;
}

function shorten(line: string, length: number) {
  if (line.length <= length) return line;
  if (length < 36) return line.slice(0, length);
  const body = line.slice(0, length - 28);
  const wordBoundary = body.lastIndexOf(' ');
  return `${body.slice(0, wordBoundary > 0 ? wordBoundary : body.length).trimEnd()} [details shortened]`;
}

/** Keeps whole, question-relevant notes first when the local model window is tight. */
export function fitContextNotes(contextText: string, maxChars: number, question: string) {
  const lines = contextText.split('\n').filter((line) => line && !GENERIC_LABELS.has(line.toLocaleLowerCase()));
  if (!lines.length || maxChars <= 0) return { text: '', omitted: 0 };
  const ordered = lines.map((line, index) => ({ line, index, priority: priority(line, question.toLocaleLowerCase()) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index);
  const selected: string[] = [];
  let remaining = maxChars;
  let omitted = 0;
  for (const item of ordered) {
    const separator = selected.length ? 1 : 0;
    if (item.line.length + separator <= remaining) {
      selected.push(item.line);
      remaining -= item.line.length + separator;
    } else if (remaining >= 50 && item.priority <= 2) {
      const shortened = shorten(item.line, remaining - separator);
      if (shortened.length >= 36) {
        selected.push(shortened);
        remaining -= shortened.length + separator;
      }
      omitted += 1;
    } else {
      omitted += 1;
    }
  }
  if (omitted && remaining >= 38) selected.push('Some less relevant notes were omitted to fit the on-device model window. Ask a focused follow-up for those details.');
  return { text: selected.join('\n'), omitted };
}
