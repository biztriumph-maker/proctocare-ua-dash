import { useState, useMemo, useCallback } from "react";
import { Plus, Phone, MessageCircle, AlertTriangle } from "lucide-react";
import { ViewToggle } from "@/components/ViewToggle";
import { StatusFilterBar, type FilterType } from "@/components/StatusFilterBar";
import { AIAlertSection } from "@/components/AIAlertSection";
import { AIReplyModal, type AIAlertDetail } from "@/components/AIReplyModal";
import { PatientCard, type Patient, type PatientStatus } from "@/components/PatientCard";
import { PatientDetailView } from "@/components/PatientDetailView";
import { CalendarView } from "@/components/CalendarView";
import { NewEntryForm, type NewEntryData } from "@/components/NewEntryForm";
import { SearchBar } from "@/components/SearchBar";
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
  { id: "t1", name: "Гриценко Марія", time: "08:00", procedure: "Колоноскопія", status: "risk", aiSummary: "Не підтверджено прийом препарату (Фортранс)" },
  { id: "t2", name: "Петренко Олег", time: "09:00", procedure: "Ректоскопія", status: "progress", aiSummary: "Розпочато підготовку" },
  { id: "t3", name: "Сидоренко Ірина", time: "10:00", procedure: "Колоноскопія", status: "ready", aiSummary: "Готова до процедури" },
  { id: "t4", name: "Кравченко Дмитро", time: "14:00", procedure: "Аноскопія", status: "risk", aiSummary: "Аналізи не завантажені" },
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
  const [searchQuery, setSearchQuery] = useState("");

  const counts = useMemo(() => ({
    total: patients.length,
    ready: patients.filter((p) => p.status === "ready").length,
    risk: patients.filter((p) => p.status === "risk").length,
    attention: patients.filter((p) => p.status === "progress").length,
  }), [patients]);

  const filtered = useMemo(() => {
    let list = patients;
    if (filter !== "all") {
      list = list.filter((p) => statusToFilter[p.status] === filter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list;
  }, [filter, patients, searchQuery]);

  const filteredTomorrow = useMemo(() => {
    if (!searchQuery.trim()) return MOCK_TOMORROW;
    const q = searchQuery.toLowerCase();
    return MOCK_TOMORROW.filter((p) => p.name.toLowerCase().includes(q));
  }, [searchQuery]);

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
      aiSummary: entry.aiPrep ? "ШІ-бот надсилає інструкції..." : "Очікує підготовки",
    };
    setSkeletonPatient(newPatient);
    setShowForm(false);
    setNewlyCreatedId(newId);
    setTimeout(() => {
      setSkeletonPatient(null);
      setPatients((prev) => [...prev, newPatient]);
      setSelectedPatient(newPatient);
      toast.success(`Запис створено: ${entry.name} о ${entry.time}`, {
        description: entry.aiPrep ? "ШІ-бот розпочав підготовку" : undefined,
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

  const handleNoShow = useCallback((patientId: string) => {
    setPatients((prev) =>
      prev.map((p) =>
        p.id === patientId ? { ...p, noShow: true } : p
      )
    );
    toast("Пацієнта позначено як «Не з'явився»");
  }, []);

  const handleComplete = useCallback((patientId: string) => {
    setPatients((prev) =>
      prev.map((p) =>
        p.id === patientId ? { ...p, completed: true, status: "ready" as PatientStatus } : p
      )
    );
    toast.success("Процедуру позначено як виконану");
  }, []);

  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toLocaleDateString("uk-UA", { weekday: "short", day: "numeric", month: "short" });

  const tomorrowRiskCount = MOCK_TOMORROW.filter(p => p.status === "risk").length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b-[2px] border-white px-3 sm:px-6 pt-2 pb-2 sm:pt-3 sm:pb-3 space-y-1.5 sm:space-y-2.5 shadow-[0_2px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div>
            <h1 className="text-base sm:text-xl font-bold text-foreground leading-tight tracking-tight">ProctoCare</h1>
            <p className="text-[11px] sm:text-sm text-muted-foreground">
              {new Date().toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SearchBar onSearch={setSearchQuery} />
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
          <div className="grid grid-cols-1 md:grid-cols-[320px_1fr] lg:grid-cols-[340px_1fr] xl:grid-cols-[360px_1fr] gap-3 sm:gap-5">
            {/* Column 1: AI Alerts */}
            <div className="space-y-3 sm:space-y-4">
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

              {/* Tomorrow card — same size as AI alerts */}
              <button
                onClick={() => setShowTomorrow(!showTomorrow)}
                className={cn(
                  "w-full rounded-xl p-4 text-center transition-all duration-200 active:scale-[0.98] animate-reveal-up",
                  showTomorrow
                    ? "bg-primary text-primary-foreground shadow-card"
                    : "bg-[hsl(270,80%,90%)] border-2 border-[hsl(270,70%,80%)] shadow-card hover:shadow-card-hover"
                )}
              >
                <div className="flex items-center justify-center gap-2 mb-2">
                  <h3 className={cn("text-sm font-semibold", showTomorrow ? "text-primary-foreground" : "text-foreground")}>
                    Завтра · {tomorrowStr}
                  </h3>
                  {tomorrowRiskCount > 0 && (
                    <span className="w-6 h-6 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[11px] font-bold shadow-sm">
                      {tomorrowRiskCount}
                    </span>
                  )}
                </div>
                <p className={cn("text-xs", showTomorrow ? "text-primary-foreground/80" : "text-muted-foreground")}>
                  {MOCK_TOMORROW.length} записів · {tomorrowRiskCount > 0 ? `${tomorrowRiskCount} потребує уваги` : "Все в нормі"}
                </p>
              </button>
            </div>

            {/* Column 2: Patient Timeline — toggles between today and tomorrow */}
            <div className="space-y-2 sm:space-y-3">
              {showTomorrow ? (
                <>
                  {/* Проблематика block */}
                  {(() => {
                    const riskTomorrow = filteredTomorrow.filter(p => p.status === "risk");
                    return riskTomorrow.length > 0 ? (
                      <div className="space-y-2 animate-reveal-up">
                        <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                          <AlertTriangle size={14} className="text-destructive" />
                          Проблематика на завтра
                        </h3>
                        {riskTomorrow.map((patient) => (
                          <div
                            key={patient.id}
                            className="flex items-center justify-between gap-3 bg-surface-raised rounded-lg p-3 border-2 border-destructive/20 shadow-card"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-foreground">
                                ⚠️ {patient.name}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {patient.aiSummary}
                              </p>
                            </div>
                            <button
                              onClick={() => handlePatientClick(patient)}
                              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-destructive text-destructive-foreground text-xs font-bold shrink-0 transition-all hover:bg-destructive/90 active:scale-[0.96] shadow-sm"
                            >
                              {patient.aiSummary.toLowerCase().includes("аналіз") ? (
                                <><MessageCircle size={14} /> Чат</>
                              ) : (
                                <><Phone size={14} /> Зателефонувати</>
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null;
                  })()}

                  {/* Tomorrow schedule */}
                  <h3 className="text-sm font-bold text-foreground mt-3">
                    Записи на завтра
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
                    {(() => {
                      const morning = filteredTomorrow.filter(p => parseInt(p.time) < 13);
                      const afternoon = filteredTomorrow.filter(p => parseInt(p.time) >= 13);
                      const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
                      if (!isDesktop) {
                        return filteredTomorrow.map((patient, i) => (
                          <PatientCard key={patient.id} patient={patient} index={i} onClick={handlePatientClick} />
                        ));
                      }
                      return (
                        <>
                          <div className="space-y-2 sm:space-y-3">
                            {morning.map((patient, i) => (
                              <PatientCard key={patient.id} patient={patient} index={i} onClick={handlePatientClick} />
                            ))}
                          </div>
                          <div className="space-y-2 sm:space-y-3">
                            {afternoon.map((patient, i) => (
                              <PatientCard key={patient.id} patient={patient} index={morning.length + i} onClick={handlePatientClick} />
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-sm font-bold text-foreground hidden md:block">
                    Сьогоднішні записи
                  </h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
                    {(() => {
                      const morning = filtered.filter(p => parseInt(p.time) < 13);
                      const afternoon = filtered.filter(p => parseInt(p.time) >= 13);
                      const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 1024;
                      if (!isDesktop) {
                        return filtered.map((patient, i) => (
                          <PatientCard key={patient.id} patient={patient} index={i} onClick={handlePatientClick} isNew={patient.id === newlyCreatedId} onNoShow={handleNoShow} />
                        ));
                      }
                      return (
                        <>
                          <div className="space-y-2 sm:space-y-3">
                            {morning.map((patient, i) => (
                              <PatientCard key={patient.id} patient={patient} index={i} onClick={handlePatientClick} isNew={patient.id === newlyCreatedId} onNoShow={handleNoShow} />
                            ))}
                          </div>
                          <div className="space-y-2 sm:space-y-3">
                            {afternoon.map((patient, i) => (
                              <PatientCard key={patient.id} patient={patient} index={morning.length + i} onClick={handlePatientClick} isNew={patient.id === newlyCreatedId} onNoShow={handleNoShow} />
                            ))}
                          </div>
                        </>
                      );
                    })()}
                    {skeletonPatient && <SkeletonCard patient={skeletonPatient} />}
                  </div>
                  {filtered.length === 0 && !skeletonPatient && (
                    <div className="text-center py-12 text-muted-foreground text-sm animate-fade-in">
                      Немає пацієнтів з таким статусом
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <CalendarView
            onSlotClick={(date, hour) => openNewEntry(date.toISOString().slice(0, 10), hour)}
            onPatientClick={(p) => {
              setSelectedPatient({
                id: `cal-${p.name}-${p.time}`,
                name: p.name,
                time: p.time,
                procedure: p.procedure,
                status: p.status,
                aiSummary: "Дані з календаря",
              });
            }}
            searchQuery={searchQuery}
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
