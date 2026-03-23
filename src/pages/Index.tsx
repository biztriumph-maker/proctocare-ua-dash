import { useState, useMemo, useCallback } from "react";
import { Plus, ChevronRight } from "lucide-react";
import { ViewToggle } from "@/components/ViewToggle";
import { StatusFilterBar, type FilterType } from "@/components/StatusFilterBar";
import { AIAlertSection } from "@/components/AIAlertSection";
import { AIReplyModal, type AIAlertDetail } from "@/components/AIReplyModal";
import { PatientCard, type Patient, type PatientStatus } from "@/components/PatientCard";
import { PatientDetailView } from "@/components/PatientDetailView";
import { CalendarView } from "@/components/CalendarView";
import { NewEntryForm, type NewEntryData } from "@/components/NewEntryForm";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const today = new Date();
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const nextWeek = new Date();
nextWeek.setDate(nextWeek.getDate() + 5);

const MOCK_PATIENTS: Patient[] = [
  { id: "1", name: "Коваленко Олена", time: "08:00", procedure: "Колоноскопія", status: "ready", aiSummary: "Підготовка завершена, результати аналізів в нормі" },
  { id: "2", name: "Мельник Ігор", time: "09:00", procedure: "Ректоскопія", status: "progress", aiSummary: "Очищення розпочато, чекаємо підтвердження" },
  { id: "3", name: "Шевченко Тарас", time: "11:00", procedure: "Консультація", status: "risk", aiSummary: "Не відповідає 12+ годин, препарат не прийнятий" },
  { id: "4", name: "Бондаренко Вікторія", time: "14:00", procedure: "Колоноскопія", status: "ready", aiSummary: "Всі етапи підготовки пройдені успішно" },
  { id: "5", name: "Ткаченко Наталія", time: "16:00", procedure: "Аноскопія", status: "progress", aiSummary: "Дієта дотримується, очікуємо прийом препарату" },
  { id: "6", name: "Лисенко Андрій", time: "17:00", procedure: "Колоноскопія", status: "risk", aiSummary: "Алергія не підтверджена, потрібна консультація" },
];

const MOCK_TOMORROW: Patient[] = [
  { id: "t1", name: "Гриценко Марія", time: "08:00", procedure: "Колоноскопія", status: "risk", aiSummary: "Препарат ще не отримано" },
  { id: "t2", name: "Петренко Олег", time: "09:00", procedure: "Ректоскопія", status: "progress", aiSummary: "Розпочато підготовку" },
  { id: "t3", name: "Сидоренко Ірина", time: "10:00", procedure: "Колоноскопія", status: "ready", aiSummary: "Готова до процедури" },
];

const MOCK_AI_ALERTS: AIAlertDetail[] = [
  {
    id: "a1",
    patientName: "Шевченко Тарас",
    question: "Чи можна приймати Фортранс з діабетом 2 типу?",
    timestamp: "Сьогодні, 10:20",
    appointmentDate: today,
    appointmentTime: "11:00",
    chatHistory: [
      { sender: "ai", text: "Доброго дня! Починайте підготовку за інструкцією: дієта без клітковини за 3 дні.", time: "09:00" },
      { sender: "patient", text: "Дякую. А у мене діабет 2 типу — мені точно можна Фортранс?", time: "10:18" },
    ],
  },
  {
    id: "a2",
    patientName: "Лисенко Андрій",
    question: "Пацієнт запитує про альтернативу препарату",
    timestamp: "Сьогодні, 11:05",
    appointmentDate: tomorrow,
    appointmentTime: "17:00",
    chatHistory: [
      { sender: "ai", text: "Вам призначено Мовіпреп для підготовки. Почніть прийом о 18:00.", time: "10:30" },
      { sender: "patient", text: "Я не переношу цей препарат — мене від нього нудить. Є щось інше?", time: "11:02" },
    ],
  },
  {
    id: "a3",
    patientName: "Іваненко Петро",
    question: "Запитує про дієту перед процедурою",
    timestamp: "Вчора, 18:30",
    appointmentDate: nextWeek,
    appointmentTime: "09:00",
    chatHistory: [
      { sender: "ai", text: "Доброго дня! Ваша процедура через тиждень.", time: "18:00" },
      { sender: "patient", text: "Що можна їсти за 5 днів до процедури?", time: "18:28" },
    ],
  },
];

const statusToFilter: Record<PatientStatus, FilterType> = {
  ready: "ready",
  progress: "attention",
  risk: "risk",
};

export default function Index() {
  const [view, setView] = useState<"operational" | "calendar">("operational");
  const [filter, setFilter] = useState<FilterType>("all");
  const [showForm, setShowForm] = useState(false);
  const [formPrefill, setFormPrefill] = useState<{ date?: string; time?: string }>({});
  const [showTomorrow, setShowTomorrow] = useState(false);
  const [patients, setPatients] = useState(MOCK_PATIENTS);
  const [replyAlert, setReplyAlert] = useState<AIAlertDetail | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [newlyCreatedId, setNewlyCreatedId] = useState<string | null>(null);
  const [skeletonPatient, setSkeletonPatient] = useState<Patient | null>(null);

  const counts = useMemo(() => ({
    total: patients.length,
    ready: patients.filter((p) => p.status === "ready").length,
    risk: patients.filter((p) => p.status === "risk").length,
    attention: patients.filter((p) => p.status === "progress").length,
  }), [patients]);

  const filtered = useMemo(() => {
    if (filter === "all") return patients;
    return patients.filter((p) => statusToFilter[p.status] === filter);
  }, [filter, patients]);

  const openNewEntry = useCallback((date?: string, hour?: number) => {
    setFormPrefill({
      date: date || undefined,
      time: hour !== undefined ? `${String(hour).padStart(2, "0")}:00` : undefined,
    });
    setShowForm(true);
  }, []);

  const handleSaveEntry = useCallback((entry: NewEntryData) => {
    const newId = `new-${Date.now()}`;
    const newPatient: Patient = {
      id: newId,
      name: entry.name,
      time: entry.time,
      procedure: entry.procedure,
      status: "progress",
      aiSummary: entry.aiPrep ? "ІІ-бот надсилає інструкції..." : "Очікує підготовки",
    };
    setSkeletonPatient(newPatient);
    setShowForm(false);
    setNewlyCreatedId(newId);
    setTimeout(() => {
      setSkeletonPatient(null);
      setPatients((prev) => [...prev, newPatient]);
      setSelectedPatient(newPatient);
      toast.success(`Запис створено: ${entry.name} о ${entry.time}`, {
        description: entry.aiPrep ? "ІІ-бот розпочав підготовку" : undefined,
      });
    }, 1500);
    setTimeout(() => setNewlyCreatedId(null), 4500);
  }, []);

  const handleAIReply = useCallback((alertId: string) => {
    const alert = MOCK_AI_ALERTS.find((a) => a.id === alertId);
    if (!alert) return;
    setPatients((prev) =>
      prev.map((p) =>
        p.name === alert.patientName && p.status === "risk"
          ? { ...p, status: "progress" as PatientStatus, aiSummary: "Відповідь надана лікарем" }
          : p
      )
    );
    toast.success(`Відповідь надіслано: ${alert.patientName}`);
  }, []);

  const handleOpenReply = useCallback((alertId: string) => {
    const alert = MOCK_AI_ALERTS.find((a) => a.id === alertId);
    if (alert) setReplyAlert(alert);
  }, []);

  const handleSendReply = useCallback((alertId: string, _message: string) => {
    setReplyAlert(null);
    handleAIReply(alertId);
  }, [handleAIReply]);

  const handlePatientClick = useCallback((patient: Patient) => {
    setSelectedPatient(patient);
  }, []);

  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toLocaleDateString("uk-UA", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/60 px-3 sm:px-6 pt-2 pb-2 sm:pt-3 sm:pb-3 space-y-1.5 sm:space-y-2.5">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div>
            <h1 className="text-base sm:text-xl font-bold text-foreground leading-tight tracking-tight">ProctoCare</h1>
            <p className="text-[11px] sm:text-sm text-muted-foreground">
              {new Date().toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" })}
            </p>
          </div>
          <button
            onClick={() => openNewEntry()}
            className={cn(
              "w-9 h-9 sm:w-11 sm:h-11 flex items-center justify-center rounded-full bg-primary text-primary-foreground",
              "shadow-[0_2px_8px_rgba(0,0,0,0.15),0_0_0_3px_hsl(var(--primary)/0.2)]",
              "hover:shadow-[0_4px_16px_rgba(0,0,0,0.2),0_0_0_4px_hsl(var(--primary)/0.25)]",
              "active:scale-[0.93] transition-all duration-200"
            )}
          >
            <Plus size={20} strokeWidth={2.5} />
          </button>
        </div>

        <div className="max-w-7xl mx-auto space-y-1.5 sm:space-y-2.5">
          <ViewToggle activeView={view} onViewChange={setView} />
          {view === "operational" && (
            <StatusFilterBar activeFilter={filter} onFilterChange={setFilter} counts={counts} />
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-2 sm:py-4 pb-24">
        {view === "operational" ? (
          <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] lg:grid-cols-[340px_1fr] xl:grid-cols-[360px_1fr] gap-5">
            {/* Column 1: AI Alerts (SOS) */}
            <div className="space-y-4">
              <AIAlertSection
                alerts={MOCK_AI_ALERTS.map((a) => ({
                  id: a.id,
                  patientName: a.patientName,
                  question: a.question,
                  appointmentDate: a.appointmentDate,
                  appointmentTime: a.appointmentTime,
                }))}
                onReply={handleAIReply}
                onOpenReply={handleOpenReply}
              />

              {/* Tomorrow chip */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setShowTomorrow(!showTomorrow)}
                  className={cn(
                    "flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 active:scale-[0.96]",
                    showTomorrow
                      ? "bg-primary text-primary-foreground shadow-card"
                      : "bg-surface-raised text-muted-foreground border border-border/50 shadow-card hover:shadow-card-hover"
                  )}
                >
                  <ChevronRight size={12} className={cn("transition-transform duration-200", showTomorrow && "rotate-90")} />
                  Завтра · {tomorrowStr}
                </button>
                {!showTomorrow && (() => {
                  const riskPatients = MOCK_TOMORROW.filter((p) => p.status === "risk" || p.status === "progress");
                  const first = riskPatients.sort((a, b) => a.time.localeCompare(b.time))[0];
                  return riskPatients.length > 0 && first ? (
                    <span className="text-xs font-semibold text-status-risk animate-fade-in">
                      ⚠ {riskPatients.length} потребує уваги о {first.time}
                    </span>
                  ) : null;
                })()}
              </div>

              {showTomorrow && (
                <div className="space-y-2.5 pl-3 border-l-2 border-primary/20 animate-reveal-up">
                  <p className="text-xs font-semibold text-muted-foreground">Ранкові записи на завтра</p>
                  {MOCK_TOMORROW.map((patient, i) => (
                    <PatientCard
                      key={patient.id}
                      patient={patient}
                      index={i}
                      onClick={handlePatientClick}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Column 2: Patient Timeline — uses full width */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-foreground hidden md:block">
                Сьогоднішні записи
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 gap-3">
                {filtered.map((patient, i) => (
                  <PatientCard
                    key={patient.id}
                    patient={patient}
                    index={i}
                    onClick={handlePatientClick}
                    isNew={patient.id === newlyCreatedId}
                  />
                ))}
                {skeletonPatient && <SkeletonCard patient={skeletonPatient} />}
              </div>
              {filtered.length === 0 && !skeletonPatient && (
                <div className="text-center py-12 text-muted-foreground text-sm animate-fade-in">
                  Немає пацієнтів з таким статусом
                </div>
              )}
            </div>
          </div>
        ) : (
          <CalendarView
            onSlotClick={(date, hour) => openNewEntry(date.toISOString().slice(0, 10), hour)}
          />
        )}
      </main>

      {showForm && (
        <NewEntryForm
          prefillDate={formPrefill.date}
          prefillTime={formPrefill.time}
          onClose={() => setShowForm(false)}
          onSave={handleSaveEntry}
        />
      )}
      {replyAlert && (
        <AIReplyModal
          alert={replyAlert}
          onClose={() => setReplyAlert(null)}
          onSend={handleSendReply}
        />
      )}
      {selectedPatient && (
        <PatientDetailView
          patient={selectedPatient}
          onClose={() => setSelectedPatient(null)}
        />
      )}
    </div>
  );
}

function SkeletonCard({ patient }: { patient: Patient }) {
  return (
    <div className="w-full bg-surface-raised rounded-xl border-l-4 border-l-status-progress px-4 py-3 border border-border/50 shadow-card animate-pulse">
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-muted animate-pulse" />
          <div className="h-3.5 w-14 bg-muted rounded animate-pulse" />
          <div className="h-3.5 w-24 bg-muted rounded-full animate-pulse" />
        </div>
        <div className="h-4.5 w-36 bg-muted rounded animate-pulse" />
        <div className="flex items-center gap-2">
          <div className="h-3.5 w-24 bg-muted rounded animate-pulse" />
          <div className="h-3.5 w-44 bg-primary/10 rounded animate-pulse" />
        </div>
      </div>
      <p className="text-xs text-primary font-medium mt-2 flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        Створення запису для {patient.name}...
      </p>
    </div>
  );
}
