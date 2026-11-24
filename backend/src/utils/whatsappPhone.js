/**
 * Parse up to 3 numbers from one stored student phone field.
 * Separators: comma, semicolon, pipe, newline.
 */
function parseStudentPhones(raw) {
  if (raw == null || String(raw).trim() === "") return [];
  return String(raw)
    .split(/[,;|\n]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * Convert a Pakistan local/mobile number to WhatsApp digits (country code, no +).
 * Examples: 03001234567 -> 923001234567, 923001234567 -> 923001234567
 */
function toPakistanWhatsAppDigits(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("92") && digits.length >= 12) {
    return digits;
  }

  if (digits.startsWith("0") && digits.length >= 11) {
    return `92${digits.slice(1)}`;
  }

  // Local mobile without leading 0: 3001234567
  if (digits.length === 10 && digits.startsWith("3")) {
    return `92${digits}`;
  }

  return null;
}

/** First stored number only, as WhatsApp E.164 digits (no +). */
function firstPhoneToWhatsApp(rawPhoneField) {
  const first = parseStudentPhones(rawPhoneField)[0];
  if (!first) {
    return { ok: false, reason: "no_number", waDigits: null, rawFirst: null };
  }
  const waDigits = toPakistanWhatsAppDigits(first);
  if (!waDigits) {
    return { ok: false, reason: "invalid_number", waDigits: null, rawFirst: first };
  }
  return { ok: true, reason: null, waDigits, rawFirst: first };
}

module.exports = {
  parseStudentPhones,
  toPakistanWhatsAppDigits,
  firstPhoneToWhatsApp,
};
