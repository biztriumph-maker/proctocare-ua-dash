import { MessageCircle, ChevronDown, AlertTriangle, Send } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { getUnclosedVisits } from "@/lib/supabaseSync";
import { supabase } from "@/lib/supabaseClient";

interface AIAlert {
  id: string;
  patientId: string;
  visitIso: string;
  patientName: string;
  patientPhone?: string;
  question: string;
  appointmentDate: Date;
  appointmentTime: string;
  chatPreview: Array<{ sender: "ai" | "patient" | "doctor"; text: string; time: string }>;
  sos?: boolean;
}

interface AIAlertSectionProps {
  alerts: AIAlert[];
  onSendReply: (id: string, message: string) => void;
  doctorPhone?: string;
}

function getDateBadge(date: Date): { label: string; className: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return { label: "СЬОГОДНІ", className: "text-white bg-status-risk font-bold" };
  }
  if (diffDays === 1) {
    return { label: "ЗАВТРА", className: "text-white bg-status-progress font-bold" };
  }
  const formatted = date.toLocaleDateString("uk-UA", { day: "numeric", month: "short" }).toUpperCase().replace(".", "");
  return { label: formatted, className: "text-muted-foreground bg-muted font-bold" };
}

export function AIAlertSection({ alerts, onSendReply, doctorPhone }: AIAlertSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [callingId, setCallingId] = useState<string | null>(null);
  const [showDeferred, setShowDeferred] = useState(false);
  const [unclosedVisits, setUnclosedVisits] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    getUnclosedVisits().then(setUnclosedVisits);
  }, []);

  const closeVisit = async (status: string) => {
    const visit = unclosedVisits[0];
    await supabase
      .from('visits')
      .update({
        status: status,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', visit.id);

    const updated = unclosedVisits.slice(1);
    setUnclosedVisits(updated);
    if (updated.length === 0) {
      setModalOpen(false);
    }
  };

  const visible = useMemo(() => {
    return alerts
      .sort((a, b) => {
        const [hA, mA] = (a.appointmentTime || "00:00").split(":").map((x) => parseInt(x || "0", 10));
        const [hB, mB] = (b.appointmentTime || "00:00").split(":").map((x) => parseInt(x || "0", 10));
        const dateA = new Date(a.appointmentDate).getTime() + ((hA * 60 + mA) * 60000);
        const dateB = new Date(b.appointmentDate).getTime() + ((hB * 60 + mB) * 60000);
        return dateA - dateB;
      });
  }, [alerts]);

  const primaryAlert = visible[0] || null;
  const extraAlerts = visible.slice(1);

  const renderBoldText = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return (
      <>
        {parts.map((part, i) =>
          part.startsWith("**") && part.endsWith("**")
            ? <strong key={i}>{part.slice(2, -2)}</strong>
            : <span key={i}>{part}</span>
        )}
      </>
    );
  };

  const normalizePhoneForViber = (value?: string): string => {
    if (!value) return "";
    const digits = value.replace(/\D/g, "");
    if (!digits) return "";
    if (digits.startsWith("380")) return `+${digits}`;
    if (digits.startsWith("0")) return `+38${digits}`;
    return `+${digits}`;
  };

  const getViberCallHref = (value?: string): string => {
    const normalized = normalizePhoneForViber(value);
    if (!normalized) return "";
    return `viber://calls?number=${encodeURIComponent(normalized)}`;
  };

  const getTelHref = (value?: string): string => {
    const normalized = normalizePhoneForViber(value);
    if (!normalized) return "";
    return `tel:${normalized}`;
  };

  const doctorPhoneNormalized = normalizePhoneForViber(doctorPhone);
  const busyAfter1900Template = doctorPhoneNormalized
    ? `Я зараз зайнятий. Передзвоніть мені, будь ласка, після 19:00 на мій телефон: ${doctorPhoneNormalized}.`
    : "Я зараз зайнятий. Передзвоніть мені, будь ласка, після 19:00.";

  const handleCallClick = (alert: AIAlert) => {
    const viberHref = getViberCallHref(alert.patientPhone);
    const telHref = getTelHref(alert.patientPhone);
    if (!viberHref || !telHref) return;

    setCallingId(alert.id);

    let fallbackTriggered = false;
    const fallbackTimer = window.setTimeout(() => {
      fallbackTriggered = true;
      window.location.href = telHref;
      setCallingId(null);
    }, 1400);

    const cancelFallbackOnHide = () => {
      if (document.visibilityState === "hidden") {
        window.clearTimeout(fallbackTimer);
        document.removeEventListener("visibilitychange", cancelFallbackOnHide);
        setCallingId(null);
      }
    };

    document.addEventListener("visibilitychange", cancelFallbackOnHide);
    window.location.href = viberHref;

    // Final safety cleanup in case neither app switch nor fallback happened.
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", cancelFallbackOnHide);
      if (!fallbackTriggered) setCallingId(null);
    }, 3000);
  };

  const renderCard = (alert: AIAlert) => {
    const badge = getDateBadge(alert.appointmentDate);
    const isExpanded = expandedId === alert.id;
    const draft = drafts[alert.id] || "";
    return (
      <div
        key={alert.id}
        className={cn(
          "bg-surface-raised rounded-lg p-3 shadow-card transition-all duration-300 border",
          alert.sos && !isExpanded ? "border-status-risk/50 animate-pulse" : "border-transparent"
        )}
      >
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-semibold text-foreground truncate">
                  {alert.patientName}
                </p>
                {alert.sos && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-status-risk text-white font-bold tracking-wide">
                    SOS
                  </span>
                )}
                <span className={cn("text-[10px] px-2 py-0.5 rounded-full shrink-0", badge.className)}>
                  {badge.label}
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {alert.question}
              </p>
            </div>
            <button
              onClick={() => setExpandedId((prev) => prev === alert.id ? null : alert.id)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-status-progress text-white text-xs font-semibold shrink-0 transition-all duration-200 hover:shadow-card-hover active:scale-[0.96]"
            >
              <MessageCircle size={14} />
              {isExpanded ? "Згорнути" : "Відповісти"}
            </button>
          </div>

          {isExpanded && (
            <div className="space-y-2 pt-1 border-t border-border/60">
              <p className="text-[11px] font-semibold text-muted-foreground">Останні повідомлення:</p>
              <div className="space-y-1.5">
                {alert.chatPreview.map((msg, i) => {
                  const isPatient = msg.sender === "patient";
                  const isDoctor = msg.sender === "doctor";
                  return (
                    <div
                      key={`${alert.id}-${i}`}
                      className={cn(
                        "rounded-lg px-2.5 py-2 text-xs border",
                        isPatient
                          ? "bg-violet-50 border-violet-200"
                          : isDoctor
                            ? "bg-emerald-50 border-emerald-200"
                            : "bg-sky-50 border-sky-200"
                      )}
                    >
                      <p className="text-[10px] font-bold text-muted-foreground mb-0.5">
                        {isPatient ? "Клієнт" : isDoctor ? "Лікар" : "Асистент"} · {msg.time}
                      </p>
                      <p className="text-foreground whitespace-pre-wrap">{renderBoldText(msg.text)}</p>
                    </div>
                  );
                })}
              </div>

              {getViberCallHref(alert.patientPhone) && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-2">
                  <button
                    onClick={() => handleCallClick(alert)}
                    disabled={callingId === alert.id}
                    className="w-full px-3 h-9 inline-flex items-center justify-center rounded-full bg-emerald-600 text-white text-xs font-semibold shadow-card hover:bg-emerald-700 active:scale-[0.93] transition-all disabled:opacity-60"
                    title={normalizePhoneForViber(alert.patientPhone)}
                  >
                    {callingId === alert.id ? "Підключення..." : "Позвонить"}
                  </button>
                </div>
              )}

              <div className="rounded-xl border-2 border-primary/35 bg-primary/5 p-2.5 space-y-1.5">
                <p className="text-[11px] font-semibold text-primary">Відповідь лікаря пацієнту</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setDrafts((prev) => ({ ...prev, [alert.id]: busyAfter1900Template }))}
                    className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-white border border-primary/25 text-primary hover:bg-primary/10 transition-colors active:scale-[0.96]"
                  >
                    Швидка відповідь: після 19:00
                  </button>
                </div>
                <div className="flex items-end gap-2 bg-background rounded-lg border border-border px-2 py-1.5">
                  <textarea
                  value={draft}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [alert.id]: e.target.value }))}
                  placeholder="Відповідь лікаря пацієнту..."
                  rows={2}
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none resize-none min-h-[44px]"
                />
                  <button
                    onClick={() => {
                      const text = draft.trim();
                      if (!text) return;
                      setSendingId(alert.id);
                      onSendReply(alert.id, text);
                      setDrafts((prev) => ({ ...prev, [alert.id]: "" }));
                      setExpandedId(null);
                      setSendingId(null);
                    }}
                    disabled={!draft.trim() || sendingId === alert.id}
                    className={cn(
                      "w-9 h-9 flex items-center justify-center rounded-full shrink-0 transition-all duration-200 active:scale-[0.93]",
                      draft.trim()
                        ? "bg-primary text-primary-foreground shadow-card"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Send size={15} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border-2 border-status-progress/30 bg-status-progress-bg p-4 space-y-2.5 animate-reveal-up">

      {/* ── Unclosed visit warning strip ── */}
      {unclosedVisits.length > 0 && (
        <div
          onClick={() => setModalOpen(true)}
          style={{
            background: '#e07b00',
            borderRadius: 10,
            padding: '11px 13px',
            marginBottom: 10,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            animation: 'pulseStrip 1.8s ease-in-out infinite',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'rgba(255,255,255,0.25)',
              display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 14,
            }}>⚠</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
                Незакритий прийом
              </div>
              <div style={{ fontSize: 11, color: '#fde9c0', marginTop: 2 }}>
                {unclosedVisits[0].patients?.full_name || unclosedVisits[0].patients?.name || '—'} · {unclosedVisits[0].visit_date}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.8)' }}>›</div>
        </div>
      )}

      {/* ── Unclosed visit modal ── */}
      {modalOpen && unclosedVisits[0] && (
        <div
          onClick={() => setModalOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(20,30,45,0.55)',
            zIndex: 200, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 16,
              padding: 22, width: '100%', maxWidth: 360,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 6 }}>
              Закрити прийом
            </div>
            <div style={{ fontSize: 13, color: '#5a7184', marginBottom: 16, lineHeight: 1.5 }}>
              Підтвердіть статус прийому. Система зафіксує дату прийому і дату підтвердження окремо.
            </div>
            <div style={{ background: '#f5f8fc', borderRadius: 10, padding: '12px 14px', marginBottom: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>
                {unclosedVisits[0].patients?.full_name || unclosedVisits[0].patients?.name || '—'}
              </div>
              <div style={{ fontSize: 13, color: '#5a7184', lineHeight: 2 }}>
                Дата прийому: {unclosedVisits[0].visit_date}<br />
                Дата підтвердження: {new Date().toLocaleDateString('uk-UA')}<br />
                Процедура: {unclosedVisits[0].procedure ?? '—'}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button onClick={() => closeVisit('completed')} style={{
                width: '100%', padding: 14, border: 'none',
                borderRadius: 10, fontSize: 15, fontWeight: 600,
                cursor: 'pointer', background: '#1fa866', color: '#ffffff',
              }}>✓  Прийом відбувся</button>
              <button onClick={() => closeVisit('no_show')} style={{
                width: '100%', padding: 14, border: 'none',
                borderRadius: 10, fontSize: 15, fontWeight: 600,
                cursor: 'pointer', background: '#d94040', color: '#ffffff',
              }}>✗  Пацієнт не з'явився</button>
              <button onClick={() => setModalOpen(false)} style={{
                width: '100%', padding: 14,
                border: '1.5px solid #c8d4de',
                borderRadius: 10, fontSize: 15, fontWeight: 400,
                cursor: 'pointer', background: '#e4eaf0', color: '#3d5166',
              }}>Скасувати</button>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-status-progress shrink-0" />
        <h3 className="text-sm font-semibold text-foreground">
          Асистент: потрібна увага
        </h3>
        <span className="ml-auto bg-status-progress text-white text-xs font-bold px-2.5 py-0.5 rounded-full tabular-nums">
          {visible.length}
        </span>
      </div>
      <div className="space-y-2">
        {primaryAlert && renderCard(primaryAlert)}
        {visible.length === 0 && (
          <div className="rounded-lg border border-dashed border-status-progress/30 bg-white/70 px-3 py-3 text-xs text-muted-foreground">
            Наразі немає звернень, що потребують відповіді лікаря.
          </div>
        )}
      </div>

      {extraAlerts.length > 0 && (
        <div>
          <button
            onClick={() => setShowDeferred(!showDeferred)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors active:scale-[0.97] py-1"
          >
            <ChevronDown
              size={14}
              className={cn("transition-transform duration-200", showDeferred && "rotate-180")}
            />
            Показати ще ({extraAlerts.length})
          </button>
          {showDeferred && (
            <div className="space-y-2 animate-reveal-up">
              {extraAlerts.map(renderCard)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
