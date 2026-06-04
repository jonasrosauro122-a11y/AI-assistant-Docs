export function sanitizeFileName(name) {
  return String(name || 'document')
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'document';
}

export function isMarkdownFile(file) {
  const name = (file?.name || '').toLowerCase();
  const type = file?.type || '';
  return name.endsWith('.md') || name.endsWith('.markdown') || type.includes('markdown') || type === 'text/plain';
}

export async function readTextFile(file) {
  return await file.text();
}

export function chunkText(input, options = {}) {
  const maxChars = options.maxChars || 1400;
  const overlapChars = options.overlapChars || 180;
  const cleaned = String(input || '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!cleaned) return [];

  const paragraphs = cleaned.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).length <= maxChars) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }

    if (current) chunks.push(current);

    if (paragraph.length <= maxChars) {
      current = paragraph;
    } else {
      for (let start = 0; start < paragraph.length; start += maxChars - overlapChars) {
        chunks.push(paragraph.slice(start, start + maxChars));
      }
      current = '';
    }
  }

  if (current) chunks.push(current);
  return chunks.map((chunk, index) => ({ chunk_text: chunk, chunk_index: index }));
}
