// Blocks in, the material to summarize out.
//
// Pure: no storage, no clock, no randomness and no chrome API. Shaping does
// not rewrite, translate, reorder, summarize or truncate — every judgement
// about what matters belongs to the model, and shaping only removes what is
// not content.

export const DEDUPE_MIN_CHARS = 8;
export const MIN_MATERIAL_CHARS = 200;
// Keep room for the instruction and answer, without assuming a model-specific
// token-to-character ratio.
export const MAX_REQUEST_MATERIAL_CHARS = 40000;

export const BLOCK_KINDS = [
  "heading",
  "paragraph",
  "list-item",
  "quote",
  "code",
  "table-cell",
];

const SPACE_SEPARATORS = /[\p{Zs}\u00a0\t]/gu;
const LINE_BREAKS = /[\r\n\u2028\u2029]/g;
const SPACE_RUNS = / {2,}/g;
const NOTHING_BUT_MARKS = /^[\p{P}\p{S}\s]+$/u;

// Every block but code: spaces normalized, line breaks folded into spaces,
// runs collapsed, trimmed.
export function normalizeText(text) {
  return String(text)
    .replace(SPACE_SEPARATORS, " ")
    .replace(LINE_BREAKS, " ")
    .replace(SPACE_RUNS, " ")
    .trim();
}

// Code is the one place a line break carries meaning: trailing spaces go, runs
// of three or more blank lines collapse to one, and the block is trimmed.
export function normalizeCode(text) {
  return String(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n")
    .trim();
}

function carriesNothing(text) {
  return text === "" || text.length < 2 || NOTHING_BUT_MARKS.test(text);
}

function renderBlock(block) {
  switch (block.kind) {
    case "heading":
      return `${"#".repeat(clampLevel(block.level))} ${block.text}`;
    case "paragraph":
      return block.text;
    case "list-item":
      return `- ${block.text}`;
    case "quote":
      return `> ${block.text}`;
    case "code":
      return "```\n" + block.text + "\n```";
    default:
      return block.text;
  }
}

function clampLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 1;
  return Math.min(6, Math.max(1, Math.trunc(n)));
}

// The kept blocks, in order, one blank line between them. The cells of one
// table row are joined into a single line so that a row still reads as a row.
export function render(blocks) {
  const lines = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.kind === "table-cell") {
      const cells = [block.text];
      while (
        i + 1 < blocks.length &&
        blocks[i + 1].kind === "table-cell" &&
        blocks[i + 1].row === block.row
      ) {
        i += 1;
        cells.push(blocks[i].text);
      }
      lines.push(cells.join(" | "));
      continue;
    }
    lines.push(renderBlock(block));
  }
  return lines.join("\n\n");
}

export function judgeSize(charCount) {
  if (charCount < MIN_MATERIAL_CHARS) return "too-little-text";
  return "ok";
}

function splitPoint(text, limit) {
  const floor = Math.floor(limit * 0.6);
  for (const pattern of [/\n/g, /[.!?。！？]\s/g, /\s/g]) {
    let point = -1;
    for (const match of text.slice(0, limit + 1).matchAll(pattern)) {
      point = match.index + match[0].length;
    }
    if (point >= floor) return point;
  }
  return limit;
}

function splitBlock(block, limit) {
  const pieces = [];
  let remaining = block.text;
  while (remaining.length > limit) {
    const point = splitPoint(remaining, limit);
    pieces.push({ ...block, text: remaining.slice(0, point).trim() });
    remaining = remaining.slice(point).trim();
  }
  if (remaining) pieces.push({ ...block, text: remaining });
  return pieces;
}

function contextText(headings) {
  if (!headings.length) return "";
  return `SECTION: ${headings.map((h) => h.text).join(" > ")}`;
}

function makeChunk(title, blocks, headings) {
  const context = contextText(headings);
  const body = render(blocks);
  const text = context ? `${context}\n\n${body}` : body;
  return {
    title,
    text,
    blocks,
    charCount: title.length + text.length,
    blockCount: blocks.length,
  };
}

function headingContextBefore(blocks, end) {
  const headings = [];
  for (let i = 0; i < end; i += 1) {
    const block = blocks[i];
    if (block.kind !== "heading") continue;
    while (
      headings.length &&
      headings[headings.length - 1].level >= block.level
    ) {
      headings.pop();
    }
    headings.push(block);
  }
  return headings;
}

// Split at major headings first, then lower headings, then ordinary block
// boundaries. Only a block that cannot fit alone is split within its text.
export function chunkMaterial(material, limit = MAX_REQUEST_MATERIAL_CHARS) {
  const source = material.blocks || [{ kind: "paragraph", text: material.text }];
  const reserve = Math.min(500, Math.floor(limit / 4));
  const blockLimit = Math.max(1, limit - material.title.length - reserve);
  const expanded = source.flatMap((block) => splitBlock(block, blockLimit));
  const chunks = [];
  let start = 0;

  while (start < expanded.length) {
    let end = start;
    while (end < expanded.length) {
      const candidate = makeChunk(
        material.title,
        expanded.slice(start, end + 1),
        headingContextBefore(expanded, start),
      );
      if (candidate.charCount > limit && end > start) break;
      end += 1;
      if (candidate.charCount > limit) break;
    }

    let boundary = Math.max(start + 1, end);
    if (boundary < expanded.length) {
      for (const maxLevel of [2, 6]) {
        for (let i = boundary - 1; i > start; i -= 1) {
          if (expanded[i].kind === "heading" && expanded[i].level <= maxLevel) {
            boundary = i;
            break;
          }
        }
        if (boundary < end) break;
      }
    }

    chunks.push(
      makeChunk(
        material.title,
        expanded.slice(start, boundary),
        headingContextBefore(expanded, start),
      ),
    );
    start = boundary;
  }
  return chunks;
}

// An ExtractResult in, a Material out or one of the two size verdicts.
export function shape(extracted) {
  const title = normalizeText(extracted && extracted.title ? extracted.title : "");
  const source = Array.isArray(extracted && extracted.blocks)
    ? extracted.blocks
    : [];

  const kept = [];
  const seen = new Set();

  for (const block of source) {
    const text =
      block.kind === "code"
        ? normalizeCode(block.text)
        : normalizeText(block.text);
    if (carriesNothing(text)) continue;

    if (text.length >= DEDUPE_MIN_CHARS) {
      const fingerprint = `${block.kind} ${text}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
    }

    const shaped = { kind: block.kind, text };
    if (block.kind === "heading") shaped.level = clampLevel(block.level);
    if (block.kind === "table-cell") shaped.row = block.row;
    kept.push(shaped);
  }

  const text = render(kept);
  const charCount = title.length + text.length;
  const verdict = judgeSize(charCount);
  if (verdict !== "ok") return { ok: false, kind: verdict };

  return {
    ok: true,
    material: { title, text, blocks: kept, charCount, blockCount: kept.length },
  };
}
