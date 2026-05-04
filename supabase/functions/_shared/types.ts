export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number };
  message?: TelegramMessage;
  data?: string; // format: "{context}:{answer}:{visitId}"
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string; // "{context}:{answer}:{visitId}" — max 64 bytes
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface MessagePayload {
  text: string;
  reply_markup?: InlineKeyboardMarkup;
}

export interface VisitWithPatient {
  visit_id: string;
  patient_id: string;
  visit_date: string;
  visit_time: string | null;
  procedure: string | null;
  drug_choice: "fortrans" | "izyklin" | null;
  telegram_id: number;
  patient_name: string;
  patient_patronymic: string | null;
}

export interface ScheduleInsertRow {
  visit_id: string;
  patient_id: string;
  block_key: string;
  scheduled_at: string; // ISO 8601 UTC
}
