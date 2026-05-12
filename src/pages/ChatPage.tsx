import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import DOMPurify from "dompurify";
import { supabase } from "@/lib/supabaseClient";

// ── Types ──────────────────────────────────────────────────────────────────────

type QuickReply = {
  yes: string;
  no?: string;
  context: string;
};

type ChatMessage = {
  sender: "ai" | "patient" | "doctor";
  text: string;
  time: string;
  quickReply?: QuickReply;
};

type VisitRow = {
  id: string;
  visit_date: string;
  visit_time: string | null;
  procedure: string | null;
  patient_id: string;
};

// ── Markdown renderer (bold / bold-italic only) ───────────────────────────────

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ChatPage() {
  const { token } = useParams<{ token: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);

  const visitIdRef = useRef<string | null>(null);
  const patientIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── On mount: resolve patient + visit + session ────────────────────────────
  useEffect(() => {
    if (!token) { setError("Посилання недійсне."); setLoading(false); return; }

    async function init() {
      // 1. Resolve patient by web_token
      const { data: patient, error: pErr } = await supabase
        .from("patients")
        .select("id, name, patronymic, web_token_revoked, web_token_expires_at")
        .eq("web_token", token)
        .maybeSingle();

      if (pErr || !patient) {
        setError("Посилання недійсне або застаріле. Зверніться до лікаря.");
        setLoading(false);
        return;
      }

      if (patient.web_token_revoked) {
        setError("Доступ до цього чату скасовано лікарем. Зверніться до лікаря.");
        setLoading(false);
        return;
      }

      if (patient.web_token_expires_at && new Date(patient.web_token_expires_at) < new Date()) {
        setError("Посилання застаріло. Зверніться до лікаря для отримання нового посилання.");
        setLoading(false);
        return;
      }

      patientIdRef.current = patient.id;

      // 2. Find the most recent non-completed visit for this patient.
      // No date filter — messages are sent immediately after registration,
      // so the patient must see the chat regardless of how far the visit date is.
      const { data: visits, error: vErr } = await supabase
        .from("visits")
        .select("id, visit_date, visit_time, procedure, patient_id")
        .eq("patient_id", patient.id)
        .or("completed.is.null,completed.eq.false")
        .or("no_show.is.null,no_show.eq.false")
        .order("visit_date", { ascending: false })
        .limit(1);

      if (vErr || !visits || visits.length === 0) {
        setError("Активний запис не знайдено. Зверніться до лікаря.");
        setLoading(false);
        return;
      }

      const visit: VisitRow = visits[0];
      visitIdRef.current = visit.id;

      // 3. Load assistant_chats session
      const { data: session } = await supabase
        .from("assistant_chats")
        .select("messages")
        .eq("id", visit.id)
        .maybeSingle();

      const msgs: ChatMessage[] = Array.isArray(session?.messages) ? session.messages as ChatMessage[] : [];
      setMessages(msgs);
      setLoading(false);

      // 4. Subscribe to Realtime on assistant_chats for this visit
      const channel = supabase
        .channel(`session-${visit.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "assistant_chats", filter: `id=eq.${visit.id}` },
          (payload) => {
            const newMsgs = (payload.new as { messages?: ChatMessage[] })?.messages;
            if (Array.isArray(newMsgs)) setMessages(newMsgs);
          }
        )
        .subscribe();

      return () => { void supabase.removeChannel(channel); };
    }

    init().catch((e) => {
      console.error("[ChatPage] init error:", e);
      setError("Сталася помилка. Спробуйте ще раз.");
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Handle quick reply button press ───────────────────────────────────────
  const handleReply = async (context: string, answer: string) => {
    if (sending || !visitIdRef.current || !token) return;
    setSending(true);
    try {
      const res = await supabase.functions.invoke("web-webhook", {
        body: { context, answer, visitId: visitIdRef.current, webToken: token },
      });
      if (res.error) {
        console.error("[ChatPage] web-webhook error:", res.error);
      } else if (Array.isArray(res.data?.messages)) {
        setMessages(res.data.messages as ChatMessage[]);
      }
    } catch (e) {
      console.error("[ChatPage] handleReply error:", e);
    } finally {
      setSending(false);
    }
  };

  // ── Derive button visibility indices ──────────────────────────────────────
  // If there's an unanswered "question_resolved" button (no patient reply after it),
  // show IT regardless of position — scheduler messages may have been appended after it.
  const unansweredQuestionIdx = messages.reduce<number>((found, m, i) => {
    if (m.sender === "ai" && m.quickReply?.context === "question_resolved") return i;
    if (m.sender === "patient" && found !== -1) return -1;
    return found;
  }, -1);

  const lastAiIdx = [...messages].map((m, i) => (m.sender === "ai" ? i : -1)).filter((i) => i >= 0).at(-1) ?? -1;
  const patientRepliedAfter = lastAiIdx >= 0 && messages.slice(lastAiIdx + 1).some((m) => m.sender === "patient");

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center text-gray-500 text-sm">Завантаження...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 px-6">
        <div className="text-center">
          <div className="text-2xl mb-2">⚠️</div>
          <p className="text-gray-700 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 max-w-lg mx-auto">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
          ЛА
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">Асистент лікаря</p>
          <p className="text-xs text-gray-400">Луцишин Юрій Андрійович</p>
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-8">
            Очікуйте першого повідомлення від асистента.
          </p>
        )}
        {messages.map((msg, idx) => {
          const isAi = msg.sender === "ai";
          const isPatient = msg.sender === "patient";
          const isLastAi = isAi && idx === lastAiIdx;
          const showInlineButtons = !!msg.quickReply && !sending && (
            unansweredQuestionIdx !== -1
              ? idx === unansweredQuestionIdx
              : isLastAi && !patientRepliedAfter
          );
          return (
            <div key={idx} className={`flex flex-col ${isPatient ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  isAi
                    ? "bg-white border border-gray-200 text-gray-800 rounded-tl-sm"
                    : isPatient
                      ? "bg-blue-600 text-white rounded-tr-sm"
                      : "bg-gray-100 text-gray-700 rounded-tl-sm"
                }`}
              >
                <span
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderMarkdown(msg.text)) }}
                />
                {msg.time && (
                  <p className={`text-[10px] mt-1 ${isPatient ? "text-blue-200" : "text-gray-400"}`}>
                    {msg.time}
                  </p>
                )}
              </div>
              {showInlineButtons && msg.quickReply && (
                <div className="flex flex-col gap-2 mt-2 w-full max-w-[85%]">
                  <button
                    onClick={() => handleReply(msg.quickReply!.context, "yes")}
                    disabled={sending}
                    className="w-full py-3 px-4 rounded-xl bg-blue-600 text-white text-sm font-medium active:scale-[0.98] transition-transform disabled:opacity-50"
                  >
                    {msg.quickReply.yes}
                  </button>
                  {msg.quickReply.no && (
                    <button
                      onClick={() => handleReply(msg.quickReply!.context, "no")}
                      disabled={sending}
                      className="w-full py-3 px-4 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium active:scale-[0.98] transition-transform disabled:opacity-50"
                    >
                      {msg.quickReply.no}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {sending && (
          <p className="text-center text-gray-400 text-xs py-1">Надсилання...</p>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
