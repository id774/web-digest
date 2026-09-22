// Blocks in, the material to summarize out.
//
// Pure: no storage, no clock, no randomness and no chrome API. Shaping does
// not rewrite, translate, reorder, summarize or truncate — every judgement
// about what matters belongs to the model, and shaping only removes what is
// not content.

export const DEDUPE_MIN_CHARS = 8;
export const MIN_MATERIAL_CHARS = 200;
// Counted in characters because shaping has no provider-specific tokenizer.
// Large material stays on the one-request path, and only material past this
// budget uses the structural chunking below.
export const MAX_REQUEST_MATERIAL_CHARS = 200000;

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

// At least three backticks, and one longer than the longest run already in
// the text, so the fence can never be mistaken for a run of backticks that
// is part of the code itself.
function codeFence(text) {
  let longest = 0;
  for (const run of String(text).match(/`+/g) || []) {
    if (run.length > longest) longest = run.length;
  }
  return "`".repeat(Math.max(3, longest + 1));
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
    case "code": {
      const fence = codeFence(block.text);
      return `${fence}\n${block.text}\n${fence}`;
    }
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

// A `\n` boundary never corrupts code the way a mid-line cut can, so it is
// preferred whenever one falls within reach of the limit. Neither piece is
// trimmed: code keeps line breaks and indentation as meaningful content
// (§8.1), shape.js's own normalization already set the block's outer edges
// once, and trimming a piece here would strip exactly the leading
// indentation or blank line the split boundary introduces. `remaining` is
// only ever sliced, never rewritten, so concatenating every piece this
// returns reproduces the original text exactly.
function splitCodeBlock(block, limit) {
  const pieces = [];
  let remaining = block.text;
  while (remaining.length > limit) {
    let point = -1;
    for (const match of remaining.slice(0, limit + 1).matchAll(/\n/g)) {
      point = match.index + match[0].length;
    }
    // No line boundary within reach: a single line longer than the limit.
    // Split at the limit itself rather than truncating, sampling or
    // otherwise dropping any of it.
    if (point <= 0) point = limit;
    pieces.push({ ...block, text: remaining.slice(0, point) });
    remaining = remaining.slice(point);
  }
  if (remaining) pieces.push({ ...block, text: remaining });
  return pieces;
}

function splitBlock(block, limit) {
  if (block.kind === "code") return splitCodeBlock(block, limit);
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
// boundaries. Only a block that cannot fit alone is split within its text —
// except a heading, which is always kept as one block: fragmenting a
// heading's text across several heading blocks would corrupt the very
// hierarchy the dedupe step and the heading context below both rely on. A
// heading too large to fit alone, like any other block that cannot fit, is
// left for the existing safety check below to fail the whole call closed.
// Every chunk this returns satisfies chunk.charCount <= limit. Title,
// heading context and block text are never truncated, dropped or sampled to
// reach that bound: when no safe partition exists — the title alone leaves
// no room for body text, a single heading cannot fit alone, or
// heading-context overhead pushes some chunk past the limit — the whole
// call fails closed with [] rather than returning a partial result.
export function chunkMaterial(material, limit = MAX_REQUEST_MATERIAL_CHARS) {
  const source = material.blocks || [{ kind: "paragraph", text: material.text }];
  // A block is only split here when it could not fit even alone, in an
  // otherwise-empty chunk carrying just the title and this block's own
  // rendering wrapper (the code fence, the heading `#`s, the list marker,
  // …, measured directly by rendering the block with empty text). A code
  // block's fence length depends on its own text — a longer backtick run
  // inside it demands a longer fence — so its overhead is measured from the
  // fence the *whole, unsplit* block's text actually requires, never from
  // an empty-text stand-in; splitting only ever cuts a backtick run
  // shorter, never longer, so every split piece's own, independently
  // computed fence is never longer than the one this reserve already
  // accounted for. The actual per-position overhead of heading context
  // (§10.3) is not guessed at on top of that, with a fixed reserve or
  // otherwise, since that guess is what let a block that truly fit fine
  // get split needlessly. A block that genuinely cannot fit once its real
  // heading context is added still meets the existing safety check below
  // (`candidate.charCount > limit`) and still fails the whole call closed,
  // exactly as before.
  const expanded = source.flatMap((block) => {
    if (block.kind === "heading") return [block];
    const overhead =
      block.kind === "code"
        ? material.title.length + codeFence(block.text).length * 2 + 2
        : material.title.length + renderBlock({ ...block, text: "" }).length;
    const blockLimit = Math.max(1, limit - overhead);
    return splitBlock(block, blockLimit);
  });
  const chunks = [];
  let start = 0;

  while (start < expanded.length) {
    const headings = headingContextBefore(expanded, start);
    let end = start;
    let candidate = makeChunk(material.title, expanded.slice(start, end + 1), headings);
    if (candidate.charCount > limit) return [];
    end += 1;

    while (end < expanded.length) {
      const next = makeChunk(material.title, expanded.slice(start, end + 1), headings);
      if (next.charCount > limit) break;
      candidate = next;
      end += 1;
    }

    let boundary = end;
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

    const chunk = makeChunk(material.title, expanded.slice(start, boundary), headings);
    if (chunk.charCount > limit) return [];
    chunks.push(chunk);
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

    // A heading's structural identity is its level as well as its text: the
    // hierarchy `render` (§8.4) actually draws from `level` is what a
    // repetition fingerprint must agree with, so the same wording at two
    // different levels — `## Overview` and `### Overview` — are not the
    // same repeated block. The clamped level is used, since that is the
    // level rendering itself uses.
    const level = block.kind === "heading" ? clampLevel(block.level) : null;

    if (block.kind !== "table-cell" && text.length >= DEDUPE_MIN_CHARS) {
      const fingerprint =
        level === null ? `${block.kind} ${text}` : `${block.kind} ${level} ${text}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
    }

    const shaped = { kind: block.kind, text };
    if (block.kind === "heading") shaped.level = level;
    if (block.kind === "table-cell") shaped.row = block.row;
    kept.push(shaped);
  }

  const text = render(kept);
  const charCount = title.length + text.length;
  const verdict = judgeSize(text.length);
  if (verdict !== "ok") return { ok: false, kind: verdict };

  return {
    ok: true,
    material: { title, text, blocks: kept, charCount, blockCount: kept.length },
  };
}
