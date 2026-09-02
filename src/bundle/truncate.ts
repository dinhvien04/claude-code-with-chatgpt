/**
 * UTF-8 safe byte-budget truncation helper.
 *
 * Guarantees:
 * 1. Buffer.byteLength(result.text, "utf8") <= maxBytes strictly.
 * 2. Pre-allocates budget for notice markers.
 * 3. Never splits multi-byte UTF-8 codepoints (Vietnamese, Chinese, Emoji, etc.).
 */
export function truncateUtf8ToBytes(
  text: string,
  maxBytes: number,
  notice = "\n... (truncated to stay under limit)"
): { text: string; sizeBytes: number; truncated: boolean } {
  const textBytes = Buffer.byteLength(text, "utf8");
  if (textBytes <= maxBytes) {
    return { text, sizeBytes: textBytes, truncated: false };
  }

  const noticeBytes = Buffer.byteLength(notice, "utf8");
  const effectiveNotice = noticeBytes <= maxBytes ? notice : "";
  const effectiveNoticeBytes = Buffer.byteLength(effectiveNotice, "utf8");
  const budget = Math.max(0, maxBytes - effectiveNoticeBytes);

  const buf = Buffer.from(text, "utf8");
  let cut = Math.min(buf.length, budget);

  // If cut lands in the middle of a UTF-8 continuation byte (0b10xxxxxx), step backwards
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) {
    cut--;
  }

  // If cut lands on a leading byte whose sequence extends beyond budget, step backwards past it
  if (cut > 0) {
    const lead = buf[cut - 1];
    if ((lead & 0xe0) === 0xc0 && cut - 1 + 2 > budget) {
      cut -= 1;
    } else if ((lead & 0xf0) === 0xe0 && cut - 1 + 3 > budget) {
      cut -= 1;
    } else if ((lead & 0xf8) === 0xf0 && cut - 1 + 4 > budget) {
      cut -= 1;
    }
  }

  const safeBody = buf.subarray(0, cut).toString("utf8");
  const finalText = safeBody + effectiveNotice;
  const finalBytes = Buffer.byteLength(finalText, "utf8");

  return {
    text: finalText,
    sizeBytes: finalBytes,
    truncated: true,
  };
}
