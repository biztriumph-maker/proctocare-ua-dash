import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { TelegramUpdate } from "../_shared/types.ts";
import { sendMessage, answerCallbackQuery, editMessageReplyMarkup } from "../_shared/telegram.ts";
import {
  buildAddress,
  buildDrugChoiceText,
  buildRoadmapKText,
  buildRoadmapGText,
  buildHasQuestionText,
  buildGreetingText,
  buildReadyButtonText,
  stripHtml,
  BLOCK_KEY_TO_CONTEXT,
} from "../_shared/messages.ts";
import { buildScheduleRows } from "../_shared/scheduleBuilder.ts";
import { classifyProcedureGroup } from "../_shared/procedureGroup.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Map of callback context:answer → button label shown in dashboard chat
const REPLY_TEXT_MAP: Record<string, string> = {
  "start_prep:yes":          "Я готовий/а",
  "start_prep:no":           "Є запитання",
  "question_resolved:yes":   "Питання вирішено. Розпочати!",
  "drug_choice:yes":         "Фортранс",
  "drug_choice:no":          "Ізіклін",
  "diet_confirm:yes":        "План отримав, усе зрозуміло",
  "diet_ready:yes":          "Так, усе готово",
  "diet_on_track:yes":       "Дотримуюсь дієти",
  "prep_ready:yes":          "Усе готово до завтра",
  "day_plan_understood:yes": "План зрозумів/ла",
  "departure_k:yes":         "Препарат випив, виїжджаю",
  "day_before_confirm:yes":  "Так, пам'ятаю",
  "departure_g:yes":         "Виїжджаю",
  "has_question:no":         "Є запитання",
};

function kyivTime(): string {
  const now = new Date();
  const ddmm = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kiev",
    day: "2-digit",
    month: "2-digit",
  }).format(now);
  const hhmm = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kiev",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return `${ddmm} | ${hhmm}`;
}

Deno.serve(async (req) => {
  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── /start TOKEN: Patient registration ─────────────────────────────────────
  if (update.message?.text?.startsWith("/start")) {
    const chatId = update.message.chat.id;
    const token = (update.message.text.split(" ")[1] ?? "").trim();
    console.log(`[webhook] /start from chatId=${chatId}, token="${token}"`);

    if (!token) {
      await sendMessage(
        chatId,
        "Будь ласка, перейдіть за посиланням, яке надав Вам лікар."
      );
      return new Response("ok");
    }

    const { data: patient } = await db
      .from("patients")
      .select("id, name, patronymic, telegram_id")
      .eq("telegram_token", token)
      .maybeSingle();

    if (!patient) {
      await sendMessage(
        chatId,
        "Посилання недійсне або вже використано. Зверніться до лікаря."
      );
      return new Response("ok");
    }

    if (patient.telegram_id) {
      await sendMessage(
        chatId,
        "Цей акаунт вже підключено. Очікуйте повідомлень від асистента."
      );
      return new Response("ok");
    }

    const { error: updateErr } = await db
      .from("patients")
      .update({ telegram_id: chatId, telegram_token: null })
      .eq("id", patient.id);

    if (updateErr) {
      console.error("[webhook] failed to save telegram_id:", updateErr);
      await sendMessage(
        chatId,
        "Сталася помилка. Спробуйте ще раз або зверніться до лікаря."
      );
      return new Response("ok");
    }

    // Find the most recent upcoming visit for this patient to send the greeting
    // Use .or() to also match NULL — new visits have completed/no_show = NULL, not false
    const { data: visits } = await db
      .from("visits")
      .select("id, visit_date, visit_time, procedure")
      .eq("patient_id", patient.id)
      .or("completed.is.null,completed.eq.false")
      .or("no_show.is.null,no_show.eq.false")
      .order("visit_date", { ascending: true })
      .limit(1);

    const addr = buildAddress(patient.name, patient.patronymic);
    const confirmText =
      `${addr}, Ваш Telegram успішно підключено до системи підготовки. ` +
      `Очікуйте повідомлень від асистента лікаря.`;

    try {
      await sendMessage(chatId, confirmText);

      // If there is an upcoming visit, re-send the greeting with "Я готовий" button
      if (visits && visits.length > 0) {
        const v = visits[0];
        console.log(`[webhook] sending greeting for visit ${v.id} (${v.visit_date})`);
        const greetingText = buildGreetingText(
          patient.name,
          patient.patronymic,
          v.procedure || "",
          v.visit_date,
          v.visit_time
        );
        const readyBtnText = buildReadyButtonText(patient.patronymic);
        await sendMessage(chatId, greetingText, {
          inline_keyboard: [[
            { text: readyBtnText, callback_data: `start_prep:yes:${v.id}` },
            { text: "Є запитання", callback_data: `start_prep:no:${v.id}` },
          ]],
        });

        // Save greeting to assistant_chats so dashboard shows it via Realtime.
        // Without this the first button tap creates a session with no greeting.
        await db.from("assistant_chats").upsert(
          {
            id: v.id,
            patient_id: patient.id,
            visit_date: v.visit_date,
            messages: [{
              sender: "ai",
              text: stripHtml(greetingText),
              time: kyivTime(),
              quickReply: {
                yes: readyBtnText,
                no: "Є запитання",
                context: "start_prep",
              },
            }],
            welcome_sent: true,
            waiting_for_diet_ack: false,
            diet_instruction_sent: false,
            waiting_for_step2_ack: false,
            step2_ack_result: "none",
          },
          { onConflict: "id" }
        );
      } else {
        console.warn(`[webhook] no upcoming visits found for patient ${patient.id}`);
      }
    } catch (err) {
      console.error("[webhook] sendMessage failed during /start:", err);
    }

    return new Response("ok");
  }

  // ── callback_query: Patient tapped an inline button ─────────────────────────
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id;

    // Ack immediately so Telegram stops showing the spinner
    await answerCallbackQuery(cq.id);

    if (!chatId) return new Response("ok");

    // Remove inline buttons immediately — prevents patient from tapping twice.
    // Non-critical: wrapped in try/catch so a stale message_id never breaks the flow.
    if (cq.message?.message_id) {
      try {
        await editMessageReplyMarkup(chatId, cq.message.message_id, { inline_keyboard: [] });
      } catch (e) {
        console.warn("[webhook] editMessageReplyMarkup failed:", e);
      }
    }

    const data = cq.data ?? "";
    // Format: "{context}:{answer}:{visitId}"
    const colonIdx1 = data.indexOf(":");
    const colonIdx2 = data.indexOf(":", colonIdx1 + 1);
    if (colonIdx1 === -1 || colonIdx2 === -1) {
      console.warn("[webhook] malformed callback_data:", data);
      return new Response("ok");
    }
    const context = data.slice(0, colonIdx1);
    const answer = data.slice(colonIdx1 + 1, colonIdx2);
    const visitId = data.slice(colonIdx2 + 1);

    if (!visitId || !context) return new Response("ok");

    // Load visit + patient, verifying ownership via telegram_id
    const { data: visit } = await db
      .from("visits")
      .select(`
        id, visit_date, visit_time, procedure, drug_choice, patient_id,
        patients!inner ( id, telegram_id, name, patronymic )
      `)
      .eq("id", visitId)
      .maybeSingle();

    if (!visit) {
      console.warn("[webhook] visit not found:", visitId);
      return new Response("ok");
    }

    const pat = visit.patients as {
      id: string;
      telegram_id: number | null;
      name: string;
      patronymic: string | null;
    };

    if (pat.telegram_id !== chatId) {
      console.warn("[webhook] telegram_id mismatch for visit", visitId);
      return new Response("ok");
    }

    const addr = buildAddress(pat.name, pat.patronymic);
    const timeStr = kyivTime();

    // Load current assistant session
    const { data: session } = await db
      .from("assistant_chats")
      .select("*")
      .eq("id", visitId)
      .maybeSingle();

    const existingMsgs: unknown[] = Array.isArray(session?.messages)
      ? session.messages
      : [];

    // Patient reply text for the dashboard chat
    let replyText = REPLY_TEXT_MAP[`${context}:${answer}`] ?? answer;
    if (context === "start_prep" && answer === "yes") {
      replyText = buildReadyButtonText(pat.patronymic);
    }

    // Strip quickReply buttons from previous messages and append patient reply
    const updatedMessages: unknown[] = [
      ...(existingMsgs as Record<string, unknown>[]).map((m) => ({
        ...m,
        quickReply: undefined,
      })),
      { sender: "patient", text: replyText, time: timeStr },
    ];

    // ── Per-context logic ────────────────────────────────────────────────────
    let visitUpdates: Record<string, unknown> = {};
    const aiMessages: Array<{ text: string; quickReply?: unknown }> = [];
    let dietInstructionSentNow = false;

    // Helper: push an AI message to the list.
    // text is HTML (for Telegram) — stripped to **markdown** before dashboard storage.
    function pushAiMsg(text: string, quickReply?: unknown) {
      aiMessages.push({ text: stripHtml(text), quickReply });
    }

    if (context === "start_prep" && answer === "yes") {
      visitUpdates = { status: "yellow" };
      const procGroup = classifyProcedureGroup(visit.procedure ?? "");

      if (procGroup === "K") {
        const drugText = buildDrugChoiceText(addr);
        const tgMarkup = {
          inline_keyboard: [[
            { text: "Фортранс", callback_data: `drug_choice:yes:${visitId}` },
            { text: "Ізіклін",  callback_data: `drug_choice:no:${visitId}` },
          ]],
        };
        await sendMessage(chatId, drugText, tgMarkup);
        pushAiMsg(drugText, {
          yes: "Фортранс",
          no: "Ізіклін",
          context: "drug_choice",
        });
      } else if (procGroup === "G") {
        const roadmapG = buildRoadmapGText();
        const tgMarkup = {
          inline_keyboard: [[
            {
              text: "План отримав, усе зрозуміло",
              callback_data: `diet_confirm:yes:${visitId}`,
            },
          ]],
        };
        await sendMessage(chatId, roadmapG, tgMarkup);
        pushAiMsg(roadmapG, {
          yes: "План отримав, усе зрозуміло",
          context: "diet_confirm",
        });
      }
    }

    if (context === "start_prep" && answer === "no") {
      visitUpdates = { status: "risk" };
      const questionText = buildHasQuestionText(addr);
      const tgMarkup = {
        inline_keyboard: [[
          {
            text: "Питання вирішено. Розпочати!",
            callback_data: `question_resolved:yes:${visitId}`,
          },
        ]],
      };
      await sendMessage(chatId, questionText, tgMarkup);
      pushAiMsg(questionText, {
        yes: "Питання вирішено. Розпочати!",
        context: "question_resolved",
      });
    }

    if (context === "drug_choice") {
      const choice = answer === "yes" ? "fortrans" : "izyklin";
      visitUpdates = { drug_choice: choice };
      dietInstructionSentNow = true;

      const roadmapK = buildRoadmapKText();
      const tgMarkup = {
        inline_keyboard: [[
          {
            text: "План отримав, усе зрозуміло",
            callback_data: `diet_confirm:yes:${visitId}`,
          },
        ]],
      };
      await sendMessage(chatId, roadmapK, tgMarkup);
      pushAiMsg(roadmapK, {
        yes: "План отримав, усе зрозуміло",
        context: "diet_confirm",
      });
    }

    if (context === "diet_confirm" && answer === "yes") {
      visitUpdates = { status: "yellow" };
      const procGroup = classifyProcedureGroup(visit.procedure ?? "");

      if (procGroup) {
        // Fetch latest drug_choice in case it was just set by drug_choice handler
        const { data: freshVisit } = await db
          .from("visits")
          .select("drug_choice")
          .eq("id", visitId)
          .maybeSingle();

        const scheduleRows = buildScheduleRows({
          visitId,
          patientId: pat.id,
          visitDate: visit.visit_date,
          procedureGroup: procGroup,
          drugChoice: freshVisit?.drug_choice ?? null,
        });

        if (scheduleRows.length > 0) {
          const { error: schedErr } = await db
            .from("message_schedule")
            .upsert(scheduleRows, { onConflict: "visit_id,block_key", ignoreDuplicates: true });
          if (schedErr) console.error("[webhook] schedule insert error:", schedErr);
        }
      }
    }

    if (context === "question_resolved" && answer === "yes") {
      visitUpdates = { status: "yellow" };
      const procGroup = classifyProcedureGroup(visit.procedure ?? "");

      if (procGroup === "K") {
        const drugText = buildDrugChoiceText(addr);
        const tgMarkup = {
          inline_keyboard: [[
            { text: "Фортранс", callback_data: `drug_choice:yes:${visitId}` },
            { text: "Ізіклін",  callback_data: `drug_choice:no:${visitId}` },
          ]],
        };
        await sendMessage(chatId, drugText, tgMarkup);
        pushAiMsg(drugText, {
          yes: "Фортранс",
          no: "Ізіклін",
          context: "drug_choice",
        });
      } else if (procGroup === "G") {
        const roadmapG = buildRoadmapGText();
        const tgMarkup = {
          inline_keyboard: [[
            {
              text: "План отримав, усе зрозуміло",
              callback_data: `diet_confirm:yes:${visitId}`,
            },
          ]],
        };
        await sendMessage(chatId, roadmapG, tgMarkup);
        pushAiMsg(roadmapG, {
          yes: "План отримав, усе зрозуміло",
          context: "diet_confirm",
        });
      }
    }

    if (context === "departure_k" || context === "departure_g") {
      visitUpdates = { status: "ready" };
    }

    // "Є запитання" tapped on a scheduled message (block7K / block8K / block9K).
    // Set status to risk and send the hasQuestion message so the patient gets
    // the "Питання вирішено. Розпочати!" button to continue after calling the doctor.
    if (context === "has_question") {
      visitUpdates = { status: "risk" };
      const questionText = buildHasQuestionText(addr);
      const tgMarkup = {
        inline_keyboard: [[
          {
            text: "Питання вирішено. Розпочати!",
            callback_data: `question_resolved:yes:${visitId}`,
          },
        ]],
      };
      await sendMessage(chatId, questionText, tgMarkup);
      pushAiMsg(questionText, {
        yes: "Питання вирішено. Розпочати!",
        context: "question_resolved",
      });
    }

    // diet_ready, diet_on_track, prep_ready, day_plan_understood,
    // day_before_confirm — update session only, no automatic next message

    // Append AI messages to session
    for (const aiMsg of aiMessages) {
      updatedMessages.push({
        sender: "ai",
        text: aiMsg.text,
        time: timeStr,
        ...(aiMsg.quickReply ? { quickReply: aiMsg.quickReply } : {}),
      });
    }

    // Upsert assistant_chats BEFORE updating visits status.
    // This ensures the dashboard's applySession() always reads the new messages
    // (with question_resolved quickReply already stripped) when the visits Realtime
    // event fires, preventing the normalization effect from reverting status to risk.
    console.log("[webhook] updatedMessages count:", updatedMessages.length);
    console.log("[webhook] visitId:", visitId);
    const { error: sessErr } = await db.from("assistant_chats").upsert(
      {
        id: visitId,
        patient_id: pat.id,
        visit_date: visit.visit_date,
        messages: updatedMessages,
        welcome_sent: true,
        waiting_for_diet_ack: session?.waiting_for_diet_ack ?? false,
        diet_instruction_sent: dietInstructionSentNow || (session?.diet_instruction_sent ?? false),
        waiting_for_step2_ack: session?.waiting_for_step2_ack ?? false,
        step2_ack_result: session?.step2_ack_result ?? "none",
      },
      { onConflict: "id" }
    );
    console.log("[webhook] sessErr after upsert:", sessErr);
    if (sessErr) console.error("[webhook] session upsert error:", sessErr);

    // Apply visit updates after assistant_chats is committed
    if (Object.keys(visitUpdates).length > 0) {
      const { error: vErr } = await db
        .from("visits")
        .update(visitUpdates)
        .eq("id", visitId);
      if (vErr) console.error("[webhook] visit update error:", vErr);
    }

    return new Response("ok");
  }

  return new Response("ok");
});
