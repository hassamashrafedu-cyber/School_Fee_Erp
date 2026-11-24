const settingsService = require("./settingsService");
const { firstPhoneToWhatsApp } = require("../utils/whatsappPhone");

class WhatsAppValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "WhatsAppValidationError";
    this.statusCode = statusCode;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readConfig() {
  const token = String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  const wabaId = String(process.env.WHATSAPP_WABA_ID || "").trim();
  const templateName = String(process.env.WHATSAPP_TEMPLATE_NAME || "fee_pending_reminder").trim();
  const templateLanguage = String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en").trim();
  const apiVersion = String(process.env.WHATSAPP_API_VERSION || "v21.0").trim();
  // Locked fee_pending_reminder shape: header school_name, body student_name + amount
  const bodyVars = String(process.env.WHATSAPP_BODY_VARS || "student_name,amount")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const headerVar = String(
    process.env.WHATSAPP_HEADER_VAR !== undefined
      ? process.env.WHATSAPP_HEADER_VAR
      : "school_name"
  ).trim(); // header {{1}} = school name from Settings
  const delayMsRaw = Number(process.env.WHATSAPP_SEND_DELAY_MS);
  const delayMs = Number.isFinite(delayMsRaw) && delayMsRaw >= 0 ? delayMsRaw : 350;

  return {
    token,
    phoneNumberId,
    wabaId,
    templateName,
    templateLanguage,
    apiVersion,
    bodyVars,
    headerVar,
    delayMs,
    configured: Boolean(token && phoneNumberId && templateName && templateLanguage),
  };
}

function formatAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  return (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");
}

function buildSchoolDisplayName(settings) {
  const line1 = String(settings?.school_name || "").trim();
  const line2 = String(settings?.school_name_line2 || "").trim();
  if (line1 && line2) return `${line1} ${line2}`;
  return line1 || "School";
}

function resolveParam(key, ctx) {
  switch (key) {
    case "student_name":
    case "name":
      return ctx.studentName;
    case "amount":
      return ctx.amountText;
    case "school_name":
    case "school":
      return ctx.schoolName;
    default:
      return "";
  }
}

function buildTemplateComponents(cfg, ctx) {
  const components = [];

  if (cfg.headerVar) {
    components.push({
      type: "header",
      parameters: [{ type: "text", text: resolveParam(cfg.headerVar, ctx) || "School" }],
    });
  }

  if (cfg.bodyVars.length > 0) {
    components.push({
      type: "body",
      parameters: cfg.bodyVars.map((key) => ({
        type: "text",
        text: resolveParam(key, ctx) || "-",
      })),
    });
  }

  return components;
}

async function sendTemplateMessage({ to, components, cfg }) {
  const url = `https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: cfg.templateName,
      language: { code: cfg.templateLanguage },
      components,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const metaMessage =
      data?.error?.error_user_msg ||
      data?.error?.message ||
      `WhatsApp API error (${response.status})`;
    const err = new Error(metaMessage);
    err.meta = data?.error || data;
    err.status = response.status;
    throw err;
  }

  return data;
}

function friendlyMetaError(error) {
  const code = error?.meta?.code;
  const message = String(error?.message || "Send failed");
  const lower = message.toLowerCase();

  if (code === 132001 || (lower.includes("template") && lower.includes("does not exist"))) {
    return "Template not found. Check WHATSAPP_TEMPLATE_NAME and language code.";
  }
  if (code === 132000 || lower.includes("number of parameters")) {
    return "Template parameter count mismatch. Adjust WHATSAPP_BODY_VARS / WHATSAPP_HEADER_VAR in .env to match your Meta template.";
  }
  if (lower.includes("pending") || lower.includes("not approved") || code === 132015) {
    return "Template is still under review (PENDING). Wait until Meta marks it APPROVED, then try again.";
  }
  if (lower.includes("payment") || lower.includes("billing")) {
    return "Meta billing/payment issue. Test number usually needs no card; live number does.";
  }
  return message;
}

const getStatus = () => {
  const cfg = readConfig();
  return {
    configured: cfg.configured,
    phoneNumberId: cfg.phoneNumberId || null,
    wabaId: cfg.wabaId || null,
    templateName: cfg.templateName,
    templateLanguage: cfg.templateLanguage,
    bodyVars: cfg.bodyVars,
    headerVar: cfg.headerVar || null,
    hasToken: Boolean(cfg.token),
  };
};

/**
 * @param {{ students: Array<{ id?: string, name: string, phone: string, amount: number|string }> }} payload
 */
const sendFeeReminders = async (payload = {}) => {
  const cfg = readConfig();
  if (!cfg.configured) {
    throw new WhatsAppValidationError(
      "WhatsApp is not configured. Set WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME, and WHATSAPP_TEMPLATE_LANGUAGE in backend .env.",
      503
    );
  }

  const students = Array.isArray(payload.students) ? payload.students : [];
  if (students.length === 0) {
    throw new WhatsAppValidationError("Select at least one student.");
  }
  if (students.length > 2000) {
    throw new WhatsAppValidationError("Too many students in one request (max 2000).");
  }

  const settings = await settingsService.getSettings();
  const schoolName = buildSchoolDisplayName(settings);

  const results = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < students.length; i += 1) {
    const row = students[i] || {};
    const studentId = row.id != null ? String(row.id) : "";
    const studentName = String(row.name || "").trim() || "Student";
    const amountText = formatAmount(row.amount);
    const phoneInfo = firstPhoneToWhatsApp(row.phone);

    if (!phoneInfo.ok) {
      skipped += 1;
      results.push({
        id: studentId,
        name: studentName,
        status: "skipped",
        reason: phoneInfo.reason,
        phone: phoneInfo.rawFirst,
        message:
          phoneInfo.reason === "no_number"
            ? "No phone number"
            : "Invalid phone number (need Pakistan mobile, first number only)",
      });
      continue;
    }

    const ctx = { studentName, amountText, schoolName };
    const components = buildTemplateComponents(cfg, ctx);

    try {
      const data = await sendTemplateMessage({
        to: phoneInfo.waDigits,
        components,
        cfg,
      });
      sent += 1;
      results.push({
        id: studentId,
        name: studentName,
        status: "sent",
        phone: phoneInfo.waDigits,
        messageId: data?.messages?.[0]?.id || null,
        message: "Sent",
      });
    } catch (error) {
      failed += 1;
      results.push({
        id: studentId,
        name: studentName,
        status: "failed",
        phone: phoneInfo.waDigits,
        message: friendlyMetaError(error),
        metaCode: error?.meta?.code || null,
      });
    }

    if (i < students.length - 1 && cfg.delayMs > 0) {
      await sleep(cfg.delayMs);
    }
  }

  return {
    schoolName,
    templateName: cfg.templateName,
    templateLanguage: cfg.templateLanguage,
    totals: {
      selected: students.length,
      sent,
      failed,
      skipped,
    },
    results,
  };
};

module.exports = {
  WhatsAppValidationError,
  getStatus,
  sendFeeReminders,
  readConfig,
};
