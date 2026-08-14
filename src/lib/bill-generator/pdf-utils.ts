/**
 * Low-level PDF content stream manipulation utilities.
 *
 * These operate on raw (decompressed) PDF content stream bytes,
 * replicating the pikepdf-based approach from the Python generators.
 */

import {
  PDFDocument,
  PDFPage,
  PDFName,
  PDFArray,
  PDFRawStream,
  PDFRef,
  PDFDict,
  PDFString,
} from 'pdf-lib';
import { inflateSync, deflateSync } from 'zlib';

// ── Content stream access ───────────────────────────────────────

/**
 * Get decompressed content stream bytes from a PDF stream object.
 */
function decompressStream(pdfDoc: PDFDocument, streamObj: PDFRawStream | PDFDict): Buffer {
  if (streamObj instanceof PDFRawStream) {
    const contents = streamObj.getContents();
    const dict = streamObj.dict;
    const filter = dict.get(PDFName.of('Filter'));

    // Handle Filter as both single name (/FlateDecode) and array ([ /FlateDecode ])
    const filterStr = filter ? filter.toString() : '';
    const isFlateDecode = filterStr === '/FlateDecode' || filterStr.includes('/FlateDecode');

    if (isFlateDecode) {
      try {
        return Buffer.from(inflateSync(Buffer.from(contents)));
      } catch {
        // If decompression fails, assume uncompressed
        return Buffer.from(contents);
      }
    }
    return Buffer.from(contents);
  }
  return Buffer.from('');
}

/**
 * Create a new compressed stream to replace an existing one.
 */
function createReplacementStream(pdfDoc: PDFDocument, data: Buffer): PDFRawStream {
  const compressed = deflateSync(data);
  return pdfDoc.context.stream(compressed, {
    Filter: 'FlateDecode',
    Length: compressed.length,
  });
}

/**
 * Get content stream refs and objects for a page.
 */
export function getPageStreamRefs(pdfDoc: PDFDocument, page: PDFPage): { ref: PDFRef; stream: PDFRawStream }[] {
  const pageDict = page.node;
  const contentsRef = pageDict.get(PDFName.of('Contents'));
  if (!contentsRef) return [];

  const resolved = contentsRef instanceof PDFRef ? pdfDoc.context.lookup(contentsRef) : contentsRef;

  if (resolved instanceof PDFArray) {
    const results: { ref: PDFRef; stream: PDFRawStream }[] = [];
    for (let i = 0; i < resolved.size(); i++) {
      const itemRef = resolved.get(i);
      if (itemRef instanceof PDFRef) {
        const obj = pdfDoc.context.lookup(itemRef);
        if (obj instanceof PDFRawStream) {
          results.push({ ref: itemRef, stream: obj });
        }
      }
    }
    return results;
  }

  if (contentsRef instanceof PDFRef && resolved instanceof PDFRawStream) {
    return [{ ref: contentsRef, stream: resolved }];
  }

  return [];
}

/**
 * Read decompressed bytes from a stream, apply a transform, and replace the stream.
 */
export function transformStream(
  pdfDoc: PDFDocument,
  entry: { ref: PDFRef; stream: PDFRawStream },
  transform: (buf: Buffer) => { data: Buffer; count: number },
): number {
  const raw = decompressStream(pdfDoc, entry.stream);
  const { data, count } = transform(raw);
  if (count > 0) {
    const newStream = createReplacementStream(pdfDoc, data);
    pdfDoc.context.assign(entry.ref, newStream);
  }
  return count;
}

// ── Digit sequence replacement engine ───────────────────────────

/**
 * Collect byte offsets of all digits inside (...) PDF string literals.
 */
export function collectDigitPositions(data: Buffer): number[] {
  const positions: number[] = [];
  let i = 0;
  const length = data.length;
  while (i < length) {
    if (data[i] === 0x28) { // '('
      let depth = 1;
      let j = i + 1;
      while (j < length && depth > 0) {
        const b = data[j];
        if (b === 0x28 && data[j - 1] !== 0x5c) depth++;
        else if (b === 0x29 && data[j - 1] !== 0x5c) depth--;
        j++;
      }
      for (let k = i + 1; k < j - 1; k++) {
        if (data[k] >= 0x30 && data[k] <= 0x39) {
          positions.push(k);
        }
      }
      i = j;
    } else {
      i++;
    }
  }
  return positions;
}

/**
 * Find digit sequences matching oldStr and replace with newStr in buf.
 */
export function replaceDigitSequence(buf: Buffer, positions: number[], oldStr: string, newStr: string): number {
  const oldBytes = Buffer.from(oldStr, 'ascii');
  const newBytes = Buffer.from(newStr, 'ascii');
  const oldLen = oldBytes.length;
  let count = 0;
  let i = 0;
  while (i <= positions.length - oldLen) {
    let match = true;
    for (let d = 0; d < oldLen; d++) {
      if (buf[positions[i + d]] !== oldBytes[d]) {
        match = false;
        break;
      }
    }
    if (match) {
      for (let d = 0; d < oldLen; d++) {
        buf[positions[i + d]] = newBytes[d];
      }
      count++;
      i += oldLen;
    } else {
      i++;
    }
  }
  return count;
}

/**
 * Apply all digit-sequence replacements to a PDF content stream buffer.
 */
export function processStream(
  streamBytes: Buffer,
  streamReplacements: [string, string][],
  blankPatterns?: Buffer[],
): { data: Buffer; count: number } {
  const buf = Buffer.from(streamBytes);
  let total = 0;

  // Blank out original name/address TJ arrays
  if (blankPatterns) {
    for (const pattern of blankPatterns) {
      const blanked = blankTjPattern(pattern);
      const idx = buf.indexOf(pattern);
      if (idx >= 0) {
        blanked.copy(buf, idx);
        total++;
      }
    }
  }

  for (const [oldStr, newStr] of streamReplacements) {
    const positions = collectDigitPositions(buf);
    const count = replaceDigitSequence(buf, positions, oldStr, newStr);
    total += count;
  }

  return { data: buf, count: total };
}

/**
 * Replace all printable chars inside (...) with spaces, preserving byte count.
 */
export function blankTjPattern(pattern: Buffer): Buffer {
  const result = Buffer.from(pattern);
  let i = 0;
  while (i < result.length) {
    if (result[i] === 0x28) { // '('
      let j = i + 1;
      while (j < result.length && result[j] !== 0x29) { // ')'
        if (result[j] !== 0x5c) { // not backslash
          result[j] = 0x20; // space
        }
        j++;
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return result;
}

// ── String replacement in streams ───────────────────────────────

/**
 * Replace a parenthesized string (oldStr) -> (newStr) in PDF stream.
 * Both strings must be the same length.
 */
export function replaceStringInStream(buf: Buffer, oldStr: string, newStr: string): number {
  const oldBytes = Buffer.from(`(${oldStr})`, 'ascii');
  const newBytes = Buffer.from(`(${newStr})`, 'ascii');
  let count = 0;
  let idx = buf.indexOf(oldBytes);
  while (idx >= 0) {
    newBytes.copy(buf, idx);
    count++;
    idx = buf.indexOf(oldBytes, idx + newBytes.length);
  }
  return count;
}

/**
 * Blank out a specific parenthesized pattern in a stream buffer.
 */
export function blankPatternInStream(buf: Buffer, pattern: Buffer): number {
  const idx = buf.indexOf(pattern);
  if (idx < 0) return 0;

  for (let i = idx; i < idx + pattern.length; i++) {
    if (buf[i] === 0x28) { // '('
      let j = i + 1;
      while (j < idx + pattern.length && buf[j] !== 0x29) {
        if (buf[j] !== 0x5c) buf[j] = 0x20;
        j++;
      }
    }
  }
  return 1;
}

// ── Text overlay helpers ────────────────────────────────────────

/**
 * Escape text for PDF string literal.
 */
function escPdf(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Create a content stream that draws a white rectangle + text overlay.
 * Returns the raw content stream string.
 */
export function buildOverlayStream(config: {
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
  lines: { text: string; x: number; y: number; font: string; fontSize: number }[];
}): string {
  let stream = `q\n1 1 1 rg\n${config.boxX} ${config.boxY} ${config.boxW} ${config.boxH} re f\nQ\n`;

  for (const line of config.lines) {
    stream += `BT\n${line.font} ${line.fontSize} Tf\n0 g\n${line.x} ${line.y} Td\n(${escPdf(line.text)}) Tj\nET\n`;
  }

  return stream;
}

/**
 * Append an overlay content stream to a page.
 */
export function appendOverlayToPage(pdfDoc: PDFDocument, page: PDFPage, overlayContent: string): void {
  const stream = pdfDoc.context.stream(Buffer.from(overlayContent, 'latin1'));
  const pageDict = page.node;
  const contentsRef = pageDict.get(PDFName.of('Contents'));

  if (!contentsRef) {
    pageDict.set(PDFName.of('Contents'), pdfDoc.context.register(stream));
    return;
  }

  const resolved = pdfDoc.context.lookup(contentsRef);
  if (resolved instanceof PDFArray) {
    resolved.push(pdfDoc.context.register(stream));
  } else {
    const arr = pdfDoc.context.obj([contentsRef, pdfDoc.context.register(stream)]);
    pageDict.set(PDFName.of('Contents'), arr);
  }
}

// ── Bookmark/outline replacement ────────────────────────────────

/**
 * Replace text in PDF string objects throughout the document.
 */
export function replaceInTextObjects(
  pdfDoc: PDFDocument,
  textReplacements: [string, string][],
): number {
  let total = 0;
  const context = pdfDoc.context;

  // Iterate all indirect objects
  context.enumerateIndirectObjects().forEach(([_ref, obj]) => {
    if (obj instanceof PDFDict) {
      const keys = obj.entries();
      for (const [key, val] of keys) {
        if (val instanceof PDFString) {
          let str = val.decodeText();
          let changed = false;
          for (const [oldText, newText] of textReplacements) {
            if (str.includes(oldText)) {
              str = str.split(oldText).join(newText);
              changed = true;
            }
          }
          if (changed) {
            obj.set(key, PDFString.of(str));
            total++;
          }
        }
      }
    }
  });

  return total;
}

// ── Font registration helpers ───────────────────────────────────

/**
 * Register a standard PDF font on a page's resources if not already present.
 */
export function registerStandardFont(
  pdfDoc: PDFDocument,
  page: PDFPage,
  fontName: string,
  baseFont: string,
): void {
  const pageDict = page.node;
  let resources = pageDict.get(PDFName.of('Resources'));
  if (!resources || !(resources instanceof PDFDict)) {
    if (resources instanceof PDFRef) {
      resources = pdfDoc.context.lookup(resources);
    }
    if (!resources) return;
  }

  const resourcesDict = resources as PDFDict;
  let fonts = resourcesDict.get(PDFName.of('Font'));
  if (fonts instanceof PDFRef) {
    fonts = pdfDoc.context.lookup(fonts);
  }
  if (!fonts || !(fonts instanceof PDFDict)) return;

  const fontsDict = fonts as PDFDict;
  // Callers pass the name as it appears in content streams ("/FHB"). PDFName.of
  // adds the slash itself, so a leading one would be escaped into the key (#2FFHB)
  // and the Tf lookup would miss.
  const nameObj = PDFName.of(fontName.replace(/^\//, ''));
  if (fontsDict.get(nameObj)) return; // already registered

  const fontDict = pdfDoc.context.obj({
    Type: 'Font',
    Subtype: 'Type1',
    BaseFont: baseFont,
  });

  fontsDict.set(nameObj, fontDict);
}
