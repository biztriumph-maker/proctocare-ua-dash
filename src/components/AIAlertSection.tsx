import { MessageCircle, ChevronDown, AlertTriangle, Send, X, Check } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
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
  onVisitClosed?: () => void;
  onOpenVisit?: (visitId: string) => void;
  onStartClosingWorkflow?: (visitId: string) => void;
  reopenTrigger?: number;
  reopenVisitId?: string | null;
  refreshTrigger?: number;
}

type ModalVisit = {
  id: string;
  visit_date: string;
  procedure?: string;
  patients?: { full_name?: string; name?: string };
};

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

function formatDateDots(value: string | Date): string {
  if (typeof value === "string") {
    const parts = value.split("-");
    if (parts.length === 3) {
      return `${parts[2]}.${parts[1]}.${parts[0]}`;
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

export function AIAlertSection({ alerts, onSendReply, doctorPhone, onVisitClosed, onOpenVisit, onStartClosingWorkflow, reopenTrigger, reopenVisitId, refreshTrigger }: AIAlertSectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [callingId, setCallingId] = useState<string | null>(null);
  const [showDeferred, setShowDeferred] = useState(false);
  const [unclosedVisits, setUnclosedVisits] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalVisitId, setModalVisitId] = useState<string | null>(null);
  const [modalHasProtocol, setModalHasProtocol] = useState(false);

  useEffect(() => {
    if (reopenTrigger !== undefined && reopenTrigger > 0) {
      setModalVisitId(reopenVisitId || null);
      setModalOpen(true);
    }
  }, [reopenTrigger, reopenVisitId]);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    getUnclosedVisits().then((visits) => {
      // Extra client-side guard: only stale, not-final visits may stay in the orange warning flow.
      setUnclosedVisits(
        visits.filter((v: any) => (
          v.visit_date < today
          && v.status !== 'no_show'
          && v.status !== 'completed'
          && v.status !== 'ready'
          && !v.no_show
          && !v.completed
        ))
      );
    });
  }, [refreshTrigger]);

  useEffect(() => {
    if (!modalOpen) return;
    const fallbackId = unclosedVisits[0]?.id;
    const targetId = modalVisitId || fallbackId;
    if (!targetId) {
      setModalHasProtocol(false);
      return;
    }

    let alive = true;

    const loadProtocol = async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('protocol')
        .eq('id', targetId)
        .single();

      if (!alive) return;
      if (error) {
        console.error('Помилка завантаження protocol для модалки:', error);
        setModalHasProtocol(false);
        return;
      }

      const protocolText = typeof data?.protocol === 'string' ? data.protocol.trim() : '';
      setModalHasProtocol(protocolText.length > 0);
    };

    void loadProtocol();
    const pollId = window.setInterval(() => {
      void loadProtocol();
    }, 1200);

    return () => {
      alive = false;
      window.clearInterval(pollId);
    };
  }, [modalOpen, modalVisitId, unclosedVisits]);

  const markVisitNoShow = async () => {
    const visit = (unclosedVisits.find((v: any) => v.id === modalVisitId) || unclosedVisits[0]) as ModalVisit | undefined;
    if (!visit?.id) return;
    await supabase
      .from('visits')
      .update({ status: 'no_show', no_show: true, completed: true })
      .eq('id', visit.id);

    const updated = unclosedVisits.filter((v: any) => v.id !== visit.id);
    setUnclosedVisits(updated);
    if (updated.length === 0) {
      setModalOpen(false);
    }
    setModalVisitId(null);
    setModalHasProtocol(false);
    // Notify parent to re-fetch patients so UI reflects the new status immediately
    onVisitClosed?.();
  };

  const completeVisit = async () => {
    const visit = (unclosedVisits.find((v: any) => v.id === modalVisitId) || unclosedVisits[0]) as ModalVisit | undefined;
    if (!visit?.id) return;

    await supabase
      .from('visits')
      .update({ completed: true, status: 'completed' })
      .eq('id', visit.id);

    const updated = unclosedVisits.filter((v: any) => v.id !== visit.id);
    setUnclosedVisits(updated);
    setModalOpen(false);
    setModalVisitId(null);
    setModalHasProtocol(false);
    onVisitClosed?.();
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

  const hasUnclosed = unclosedVisits.length > 0;

  return (
    <div className={cn(
      "rounded-xl border-2 p-4 space-y-2.5 animate-reveal-up",
      hasUnclosed
        ? "border-orange-400/60 bg-orange-50"
        : "border-status-progress/30 bg-status-progress-bg"
    )}>

      {/* ── Unclosed visit warning strip ── */}
      {unclosedVisits.length > 0 && (
        <div
          onClick={() => {
            setModalVisitId(unclosedVisits[0]?.id || null);
            setModalOpen(true);
          }}
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
      {modalOpen && (unclosedVisits.find((v: any) => v.id === modalVisitId) || unclosedVisits[0]) && createPortal(
        <div
          onClick={() => setModalOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(20,30,45,0.55)',
            zIndex: 9999, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 16,
              padding: 22, width: '100%', maxWidth: 360,
              position: 'relative',
            }}
          >
            <button
              onClick={() => setModalOpen(false)}
              style={{
                position: 'absolute', top: 14, right: 14,
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              aria-label="Закрити"
            >
              <X size={24} color="#8E8E93" />
            </button>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a2b3c', marginBottom: 6 }}>
              Закрити прийом
            </div>
            <div style={{ fontSize: 13, color: '#5a7184', marginBottom: 16, lineHeight: 1.5 }}>
              Оберіть дію для цього прийому.
            </div>
            <div style={{ padding: '12px 0', marginBottom: 14 }}>
              {(() => {
                const current = (unclosedVisits.find((v: any) => v.id === modalVisitId) || unclosedVisits[0]) as ModalVisit;
                return (
                  <>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#1a2b3c', marginBottom: 8 }}>
                      {current.patients?.full_name || current.patients?.name || '—'}
                    </div>
                    <div style={{ fontSize: 13, color: '#5a7184', lineHeight: 2 }}>
                      Дата прийому: {formatDateDots(current.visit_date)}<br />
                      Дата підтвердження: {formatDateDots(new Date())}<br />
                      {((current.procedure || '').trim()) && (
                        <>Процедура: {current.procedure.trim()}<br /></>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
            {modalHasProtocol ? (
              <div style={{ color: '#1f8f4d', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
                Висновок заповнено. Тепер ви можете завершити візит.
              </div>
            ) : (
              <div style={{ color: '#d32f2f', fontSize: 13, fontWeight: 700, marginBottom: 12 }}>
                Висновок лікаря ще не заповнено!
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
              {modalHasProtocol ? (
                <button
                  onClick={() => completeVisit()}
                  style={{
                    width: '100%', padding: 14, border: 'none',
                    borderRadius: 10, fontSize: 15, fontWeight: 700,
                    cursor: 'pointer', background: '#16a34a', color: '#ffffff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <Check size={18} />
                  Завершити процедуру
                </button>
              ) : (
                <button
                  onClick={() => {
                    const current = (unclosedVisits.find((v: any) => v.id === modalVisitId) || unclosedVisits[0]) as ModalVisit;
                    onStartClosingWorkflow?.(current.id);
                    setModalOpen(false);
                    onOpenVisit?.(current.id);
                  }}
                  style={{
                    width: '100%', padding: 14, border: 'none',
                    borderRadius: 10, fontSize: 15, fontWeight: 600,
                    cursor: 'pointer', background: '#007AFF', color: '#ffffff',
                  }}
                >Заповнити протокол</button>
              )}
              <button
                onClick={() => markVisitNoShow()}
                style={{
                  width: '100%', padding: 14,
                  border: '1.5px solid #8E8E93', borderRadius: 10,
                  fontSize: 15, fontWeight: 600,
                  cursor: 'pointer', background: 'transparent', color: '#8E8E93',
                }}
              >Пацієнт не з’явився</button>
            </div>
          </div>
        </div>
      , document.body)}
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className={hasUnclosed ? "text-orange-500 shrink-0" : "text-status-progress shrink-0"} />
        <h3 className="text-sm font-semibold text-foreground">
          {hasUnclosed ? "У вас є незавершені прийоми, що потребують уваги" : "Асистент: потрібна увага"}
        </h3>
        <span className={cn("ml-auto text-white text-xs font-bold px-2.5 py-0.5 rounded-full tabular-nums", hasUnclosed ? "bg-orange-500" : "bg-status-progress")}>
          {hasUnclosed ? unclosedVisits.length : visible.length}
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
