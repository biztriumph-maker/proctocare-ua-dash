import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendMessage } from "../_shared/telegram.ts";
import { buildMessagePayload, BLOCK_KEY_TO_CONTEXT, stripHtml } from "../_shared/messages.ts";
import type { VisitWithPatient } from "../_shared/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Messages more than 2 hours late are skipped.
// This prevents a burst of stale messages if the cron was paused.
const LATE_CUTOFF_MINUTES = 120;

function kyivTimeStr(date: Date): string {
  const ddmm = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kiev",
    day: "2-digit",
    month: "2-digit",
  }).format(date);
  const hhmm = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kiev",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${ddmm} | ${hhmm}`;
}

Deno.serve(async (_req) => {
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const now = new Date();
  const cutoff = new Date(now.getTime() - LATE_CUTOFF_MINUTES * 60_000);

  // Fetch all pending rows due within the cutoff window
  const { data: pendingRows, error: fetchErr } = await db
    .from("message_schedule")
    .select("id, visit_id, patient_id, block_key, scheduled_at")
    .is("sent_at", null)
    .lte("scheduled_at", now.toISOString())
    .gte("scheduled_at", cutoff.toISOString())
    .order("scheduled_at", { ascending: true });

  if (fetchErr) {
    console.error("[scheduler] fetch error:", fetchErr);
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!pendingRows || pendingRows.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  let sent = 0;
  const errors: string[] = [];
  const timeStr = kyivTimeStr(now);

  for (const row of pendingRows) {
    // Fetch visit + patient with telegram_id
    const { data: visitRow } = await db
      .from("visits")
      .select(`
        id, visit_date, visit_time, procedure, drug_choice,
        patients!inner ( id, telegram_id, name, patronymic )
      `)
      .eq("id", row.visit_id)
      .eq("completed", false)
      .eq("no_show", false)
      .maybeSingle();

    if (!visitRow) {
      // Visit completed/no-show or deleted — mark as sent to stop retrying
      await db
        .from("message_schedule")
        .update({ sent_at: now.toISOString() })
        .eq("id", row.id);
      continue;
    }

    const patient = visitRow.patients as {
      id: string;
      telegram_id: number | null;
      name: string;
      patronymic: string | null;
    };

    if (!patient.telegram_id) {
      // Patient hasn't registered Telegram — mark sent to stop retrying
      console.warn(
        `[scheduler] no telegram_id for patient ${patient.id}, skipping block ${row.block_key}`
      );
      await db
        .from("message_schedule")
        .update({ sent_at: now.toISOString() })
        .eq("id", row.id);
      continue;
    }

    const visitWithPatient: VisitWithPatient = {
      visit_id: visitRow.id,
      patient_id: patient.id,
      visit_date: visitRow.visit_date,
      visit_time: visitRow.visit_time ?? null,
      procedure: visitRow.procedure ?? null,
      drug_choice: visitRow.drug_choice ?? null,
      telegram_id: patient.telegram_id,
      patient_name: patient.name,
      patient_patronymic: patient.patronymic ?? null,
    };

    const payload = buildMessagePayload(row.block_key, visitWithPatient);
    if (!payload) {
      errors.push(`no payload for block_key ${row.block_key}`);
      continue;
    }

    // Send to Telegram
    try {
      await sendMessage(patient.telegram_id, payload.text, payload.reply_markup);
    } catch (e) {
      errors.push(`send failed for row ${row.id}: ${e}`);
      continue;
    }

    // Mark sent atomically — the IS NULL guard prevents double-sending
    const { error: markErr } = await db
      .from("message_schedule")
      .update({ sent_at: now.toISOString() })
      .eq("id", row.id)
      .is("sent_at", null);

    if (markErr) {
      errors.push(`mark sent failed for ${row.id}: ${markErr.message}`);
      continue;
    }

    // Append message to assistant_chats so the dashboard shows it in chat history
    const { data: session } = await db
      .from("assistant_chats")
      .select("messages, waiting_for_diet_ack, diet_instruction_sent, waiting_for_step2_ack, step2_ack_result, welcome_sent, departure_message_sent")
      .eq("id", row.visit_id)
      .maybeSingle();

    const existingMsgs: unknown[] = Array.isArray(session?.messages)
      ? session.messages
      : [];

    // Build quickReply format matching frontend ChatMessage interface
    const frontendContext = BLOCK_KEY_TO_CONTEXT[row.block_key];
    const buttons = payload.reply_markup?.inline_keyboard?.[0];
    const quickReply = frontendContext && buttons
      ? {
          yes: buttons[0]?.text,
          ...(buttons[1] ? { no: buttons[1].text } : {}),
          context: frontendContext,
        }
      : undefined;

    const newMsg = {
      sender: "ai",
      text: stripHtml(payload.text),
      time: timeStr,
      ...(quickReply ? { quickReply } : {}),
    };

    const { error: chatErr } = await db.from("assistant_chats").upsert(
      {
        id: row.visit_id,
        patient_id: patient.id,
        visit_date: visitRow.visit_date,
        messages: [...existingMsgs, newMsg],
        welcome_sent: true,
        waiting_for_diet_ack: session?.waiting_for_diet_ack ?? false,
        diet_instruction_sent: session?.diet_instruction_sent ?? false,
        waiting_for_step2_ack: session?.waiting_for_step2_ack ?? false,
        step2_ack_result: session?.step2_ack_result ?? "none",
        departure_message_sent: row.block_key === "block12G_morning"
          ? true
          : (session?.departure_message_sent ?? false),
      },
      { onConflict: "id" }
    );

    if (chatErr) {
      errors.push(`assistant_chats upsert failed for row ${row.id}: ${chatErr.message}`);
      continue;
    }

    // Morning message sent — patient hasn't confirmed departure yet, flag as risk
    // so the doctor sees a red card in Оперативка / Агент immediately.
    // Only applies to Group Г morning block; skipped if patient already clicked Виїжджаю.
    if (row.block_key === "block12G_morning") {
      const { error: visitRiskErr } = await db
        .from("visits")
        .update({ status: "risk" })
        .eq("id", row.visit_id)
        .neq("status", "ready");
      if (visitRiskErr) {
        console.warn(`[scheduler] visit risk update failed for ${row.visit_id}: ${visitRiskErr.message}`);
      }
    }

    sent++;
  }

  console.log(
    `[scheduler] sent ${sent} messages, errors: ${errors.length}`,
    errors.length ? errors : ""
  );

  return new Response(JSON.stringify({ sent, errors }), {
    headers: { "Content-Type": "application/json" },
  });
});
