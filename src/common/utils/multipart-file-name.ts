const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Busboy (used by multer) decodes multipart `filename` parameters as latin1,
 * so a UTF-8 name like "YO IRÉ.mp3" arrives as "YO IRÃ\u0089.mp3". This
 * re-reads the latin1 code units as UTF-8 bytes and returns the recovered name.
 *
 * The original value is returned unchanged when it is pure ASCII, already
 * contains characters outside latin1 (decoded correctly upstream), or its
 * bytes are not valid UTF-8 (a genuine latin1 name).
 */
export function decodeMultipartFileName(name: string): string;
export function decodeMultipartFileName(
  name: string | null | undefined,
): string | null | undefined;
export function decodeMultipartFileName(
  name: string | null | undefined,
): string | null | undefined {
  if (!name || !/[\x80-\xFF]/.test(name) || /[Ā-￿]/.test(name)) {
    return name;
  }

  try {
    return strictUtf8Decoder
      .decode(Buffer.from(name, 'latin1'))
      .normalize('NFC');
  } catch {
    return name;
  }
}
