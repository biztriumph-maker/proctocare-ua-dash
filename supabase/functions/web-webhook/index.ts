import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildAddress,
  buildDrugChoiceText,
  buildMessagePayload,
  buildRoadmapKText,
  buildRoadmapGText,
  buildHasQuestionText,
  buildReadyButtonText,
  stripHtml,
  BLOCK_KEY_TO_CONTEXT,
} from "../_shared/messages.ts";
import { buildScheduleRows } from "../_shared/scheduleBuilder.ts";
import { classifyProcedureGroup } from "../_shared/procedureGroup.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

function daysUntilVisit(visitDateIso: string): number {
  const todayKyiv = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kiev" }).format(new Date());
  const todayMs = new Date(todayKyiv + "T00:00:00Z").getTime();
  const visitMs = new Date(visitDateIso + "T00:00:00Z").getTime();
  return Math.round((visitMs - todayMs) / 86_400_000);
}

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
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }

  let body: { context: string; answer: string; visitId: string; webToken: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Bad Request" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const { context, answer, visitId, webToken } = body;
  if (!context || !answer || !visitId || !webToken) {
    return new Response(JSON.stringify({ error: "Missing fields" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── Authenticate via web_token ─────────────────────────────────────────────
  const { data: patient } = await db
    .from("patients")
    .select("id, name, patronymic, web_token")
    .eq("web_token", webToken)
    .maybeSingle();

  if (!patient) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // ── Load visit and verify ownership ───────────────────────────────────────
  const { data: visit } = await db
    .from("visits")
    .select("id, visit_date, visit_time, procedure, drug_choice, patient_id")
    .eq("id", visitId)
    .maybeSingle();

  if (!visit || visit.patient_id !== patient.id) {
    return new Response(JSON.stringify({ error: "Visit not found" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const addr = buildAddress(patient.name, patient.patronymic);
  const timeStr = kyivTime();

  // ── Load current assistant session ────────────────────────────────────────
  const { data: session } = await db
    .from("assistant_chats")
    .select("*")
    .eq("id", visitId)
    .maybeSingle();

  const existingMsgs: unknown[] = Array.isArray(session?.messages) ? session.messages : [];

  // Patient reply text for dashboard chat
  let replyText = REPLY_TEXT_MAP[`${context}:${answer}`] ?? answer;
  if (context === "start_prep" && answer === "yes") {
    replyText = buildReadyButtonText(patient.patronymic);
  }

  // Strip quickReply from previous messages and append patient reply
  const updatedMessages: unknown[] = [
    ...(existingMsgs as Record<string, unknown>[]).map((m) => ({
      ...m,
      quickReply: undefined,
    })),
    { sender: "patient", text: replyText, time: timeStr },
  ];

  // ── Per-context logic ─────────────────────────────────────────────────────
  let visitUpdates: Record<string, unknown> = {};
  const aiMessages: Array<{ text: string; quickReply?: unknown }> = [];
  let dietInstructionSentNow = false;
  let departureMsgSentNow = false;
  let prepReadyAckNow = false;
  let dayPlanAckNow = false;

  function pushAiMsg(text: string, quickReply?: unknown) {
    aiMessages.push({ text: stripHtml(text), quickReply });
  }

  if (context === "start_prep" && answer === "yes") {
    visitUpdates = { status: "yellow" };
    const procGroup = classifyProcedureGroup(visit.procedure ?? "");

    if (procGroup === "K") {
      const drugText = buildDrugChoiceText(addr);
      pushAiMsg(drugText, { yes: "Фортранс", no: "Ізіклін", context: "drug_choice" });
    } else if (procGroup === "G") {
      const roadmapG = buildRoadmapGText();
      pushAiMsg(roadmapG, { yes: "План отримав, усе зрозуміло", context: "diet_confirm" });
    }
  }

  if (context === "start_prep" && answer === "no") {
    visitUpdates = { status: "risk" };
    const questionText = buildHasQuestionText(addr);
    pushAiMsg(questionText, { yes: "Питання вирішено. Розпочати!", context: "question_resolved" });
  }

  if (context === "drug_choice") {
    const choice = answer === "yes" ? "fortrans" : "izyklin";
    visitUpdates = { drug_choice: choice };
    dietInstructionSentNow = true;

    const days = daysUntilVisit(visit.visit_date);
    const roadmapK = buildRoadmapKText(days);
    pushAiMsg(roadmapK, { yes: "План отримав, усе зрозуміло", context: "diet_confirm" });
  }

  if (context === "diet_confirm" && answer === "yes") {
    visitUpdates = { status: "yellow" };
    const procGroup = classifyProcedureGroup(visit.procedure ?? "");
    if (procGroup === "G") dietInstructionSentNow = true;

    if (procGroup) {
      const { data: freshVisit } = await db
        .from("visits")
        .select("drug_choice")
        .eq("id", visitId)
        .maybeSingle();

      const scheduleRows = buildScheduleRows({
        visitId,
        patientId: patient.id,
        visitDate: visit.visit_date,
        procedureGroup: procGroup,
        drugChoice: freshVisit?.drug_choice ?? null,
      });

      if (scheduleRows.length > 0) {
        const { error: schedErr } = await db
          .from("message_schedule")
          .upsert(scheduleRows, { onConflict: "visit_id,block_key", ignoreDuplicates: true });
        if (schedErr) console.error("[web-webhook] schedule insert error:", schedErr);
      }

      const SKIP_WHEN_LATE = new Set(["block7K"]);
      const nowTime = new Date();
      const visitForPayload = {
        visit_id: visitId,
        patient_id: patient.id,
        visit_date: visit.visit_date,
        visit_time: visit.visit_time ?? null,
        procedure: visit.procedure ?? null,
        drug_choice: freshVisit?.drug_choice ?? null,
        // telegram_id not needed — web-webhook never calls sendMessage
        telegram_id: 0,
        patient_name: patient.name,
        patient_patronymic: patient.patronymic,
      };

      for (const row of scheduleRows) {
        if (SKIP_WHEN_LATE.has(row.block_key)) continue;
        if (new Date(row.scheduled_at) < nowTime) {
          const payload = buildMessagePayload(row.block_key, visitForPayload);
          if (payload) {
            try {
              await db
                .from("message_schedule")
                .update({ sent_at: nowTime.toISOString() })
                .eq("visit_id", visitId)
                .eq("block_key", row.block_key);
              const frontendContext = BLOCK_KEY_TO_CONTEXT[row.block_key];
              const buttons = payload.reply_markup?.inline_keyboard?.[0];
              const quickReply =
                frontendContext && buttons
                  ? {
                      yes: buttons[0]?.text,
                      ...(buttons[1] ? { no: buttons[1].text } : {}),
                      context: frontendContext,
                    }
                  : undefined;
              pushAiMsg(payload.text, quickReply);
              if (row.block_key === "block12G_morning") departureMsgSentNow = true;
            } catch (e) {
              console.error(`[web-webhook] immediate catch-up send failed for ${row.block_key}:`, e);
            }
          }
        }
      }

      if (departureMsgSentNow) {
        await db
          .from("visits")
          .update({ status: "risk" })
          .eq("id", visitId)
          .neq("status", "ready");
      }
    }
  }

  if (context === "question_resolved" && answer === "yes") {
    visitUpdates = { status: "yellow" };
    const procGroup = classifyProcedureGroup(visit.procedure ?? "");

    if (procGroup === "K") {
      const drugText = buildDrugChoiceText(addr);
      pushAiMsg(drugText, { yes: "Фортранс", no: "Ізіклін", context: "drug_choice" });
    } else if (procGroup === "G") {
      const roadmapG = buildRoadmapGText();
      pushAiMsg(roadmapG, { yes: "План отримав, усе зрозуміло", context: "diet_confirm" });
    }
  }

  if (context === "departure_k" || context === "departure_g") {
    visitUpdates = { status: "ready" };
  }

  const step2AckResultForUpsert =
    (context === "departure_k" || context === "departure_g" || context === "question_resolved")
      ? "none"
      : (session?.step2_ack_result ?? "none");

  if (context === "has_question") {
    visitUpdates = { status: "risk" };
    const questionText = buildHasQuestionText(addr);
    pushAiMsg(questionText, { yes: "Питання вирішено. Розпочати!", context: "question_resolved" });
  }

  if (context === "prep_ready") {
    prepReadyAckNow = true;
  }

  if (context === "day_plan_understood") {
    dayPlanAckNow = true;
  }

  // Append AI messages
  for (const aiMsg of aiMessages) {
    updatedMessages.push({
      sender: "ai",
      text: aiMsg.text,
      time: timeStr,
      ...(aiMsg.quickReply ? { quickReply: aiMsg.quickReply } : {}),
    });
  }

  // ── Upsert assistant_chats ─────────────────────────────────────────────────
  const { error: sessErr } = await db.from("assistant_chats").upsert(
    {
      id: visitId,
      patient_id: patient.id,
      visit_date: visit.visit_date,
      messages: updatedMessages,
      welcome_sent: true,
      waiting_for_diet_ack: session?.waiting_for_diet_ack ?? false,
      diet_instruction_sent: dietInstructionSentNow || (session?.diet_instruction_sent ?? false),
      waiting_for_step2_ack: session?.waiting_for_step2_ack ?? false,
      step2_ack_result: step2AckResultForUpsert,
      departure_message_sent: departureMsgSentNow || (session?.departure_message_sent ?? false),
      prep_ready_ack: prepReadyAckNow || (session?.prep_ready_ack ?? false),
      day_plan_ack: dayPlanAckNow || (session?.day_plan_ack ?? false),
      saved_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (sessErr) {
    console.error("[web-webhook] assistant_chats upsert failed:", JSON.stringify(sessErr));
    return new Response(JSON.stringify({ error: "Session save failed" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // ── Apply visit updates ────────────────────────────────────────────────────
  if (Object.keys(visitUpdates).length > 0) {
    const { error: vErr } = await db
      .from("visits")
      .update(visitUpdates)
      .eq("id", visitId);
    if (vErr) console.error("[web-webhook] visit update error:", vErr);
  }

  return new Response(
    JSON.stringify({ ok: true, messages: updatedMessages }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});
