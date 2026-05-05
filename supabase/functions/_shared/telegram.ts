const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
if (!BOT_TOKEN) {
  console.error("[telegram] TELEGRAM_BOT_TOKEN is not set!");
}
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN ?? ""}`;

async function sendTelegramRequest(
  method: string,
  body: Record<string, unknown>
): Promise<void> {
  if (!BOT_TOKEN) {
    throw new Error(`[telegram] Cannot call ${method}: TELEGRAM_BOT_TOKEN is not set`);
  }
  const res = await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`[telegram] ${method} failed (HTTP ${res.status}): ${err}`);
  }
}

export async function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: unknown
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await sendTelegramRequest("sendMessage", body);
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await sendTelegramRequest("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text ?? "",
  });
}

export async function editMessageReplyMarkup(
  chatId: number,
  messageId: number,
  replyMarkup: unknown
): Promise<void> {
  await sendTelegramRequest("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}
