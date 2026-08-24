// Telegram notifier for dry-run alerts. Sends a message (never a trade) to the
// configured chat(s). Reads the bot token from the environment and never returns
// or logs it. Chat IDs are treated as routing info, not secrets.

export interface TelegramStatus {
  enabled: boolean;
  configured: boolean;
  chatCount: number;
}

export interface TelegramSendResult extends TelegramStatus {
  attempted: boolean;
  sent: number;
  results: Array<{ chatId: string; ok: boolean; error?: string }>;
}

function chatIds(): string[] {
  return (process.env.TELEGRAM_CHAT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

// Validates the bot token by calling getMe. Returns the bot username (safe) but
// never the token.
export async function telegramGetMe(): Promise<{ ok: boolean; username?: string; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) {
    return { ok: false, error: "no_token" };
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { username?: string };
      description?: string;
    };
    if (response.ok && body.ok) {
      return { ok: true, username: body.result?.username };
    }
    return { ok: false, error: body.description || `http_${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "getme_failed" };
  }
}

export function telegramStatus(): TelegramStatus {
  const enabled = (process.env.TELEGRAM_ENABLED ?? "").toLowerCase() === "true";
  const ids = chatIds();
  const configured = Boolean(process.env.TELEGRAM_BOT_TOKEN && ids.length > 0);
  return { enabled, configured, chatCount: ids.length };
}

export async function sendTelegram(text: string): Promise<TelegramSendResult> {
  const status = telegramStatus();
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!status.enabled || !status.configured) {
    return { ...status, attempted: false, sent: 0, results: [] };
  }
  const results: TelegramSendResult["results"] = [];
  for (const chatId of chatIds()) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };
      const ok = response.ok && body.ok === true;
      results.push({ chatId, ok, error: ok ? undefined : body.description || `http_${response.status}` });
    } catch (error) {
      results.push({ chatId, ok: false, error: error instanceof Error ? error.message : "send_failed" });
    }
  }
  return { ...status, attempted: true, sent: results.filter((r) => r.ok).length, results };
}
