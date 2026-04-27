// ============================================================
// Конфіг цифрового асистента.
// ТЕКСТИ ПОВІДОМЛЕНЬ ТУТ НЕ ЗБЕРІГАЮТЬСЯ.
// Щоб додати текст — внеси його в logic.md, потім сюди.
// Поки рядок порожній — асистент мовчить. Жодних дефолтів.
// ============================================================

// ─── Класифікатор груп процедур ───────────────────────────────────────────────

/** K = колоноскопія/ректоскопія, G = гастроскопія */
export type ProcedureGroup = 'K' | 'G';

export function classifyProcedureGroup(procedureName: string): ProcedureGroup | null {
  if (!procedureName) return null;
  const n = procedureName.toLowerCase();
  const hasColono = n.includes('колоноскоп') || n.includes('ректоскоп') || n.includes('ректо-сигмоскоп') || n.includes('комплекс');
  const hasGastro = n.includes('гастроскоп');
  const hasPolyp  = n.includes('поліпектом');
  if (hasColono) return 'K';
  if (hasPolyp && hasGastro) return 'G';
  if (hasPolyp) return 'K';
  if (hasGastro) return 'G';
  return null;
}

// ─── Тексти повідомлень асистента ────────────────────────────────────────────
// Всі рядки ПОРОЖНІ. Заповнювати тільки з logic.md.

export const AGENT_CHAT_MESSAGES = {

  // Блок 5 / Точка 0: Перше звернення (logic.md — слово в слово)
  greetingTemplate: (p: {
    patientAddress: string;
    serviceName: string;
    appointmentDisplay: string;
    appointmentTime: string;
  }): string =>
    `Вітаю, ${p.patientAddress}!\n` +
    `Це цифровий асистент лікаря Луцишина Юрія Андрійовича.\n` +
    `Ви записані на процедуру: ${p.serviceName}, яка відбудеться ${p.appointmentDisplay} о ${p.appointmentTime}.\n` +
    `Юрій Андрійович доручив мені супроводжувати вашу підготовку. Моє завдання — допомогти вам пройти цей етап правильно та спокійно, щоб процедура пройшла легко та з найкращим результатом.\n` +
    `Чи готові ви розпочати нашу спільну підготовку?`,

  // Блок 5 / Логіка «Є запитання» (logic.md — слово в слово)
  hasQuestionResponse: (p: { address: string }): string =>
    `${p.address}, якщо у Вас виникло термінове запитання щодо підготовки, Ви можете особисто зателефонувати Юрію Андрійовичу за номером: **0676735101**.\n` +
    `Після того, як Ви узгодите всі питання з лікарем, обов'язково натисніть кнопку нижче, щоб ми могли розпочати процес підготовки.`,

  // Блок 4: харчування (Група К)
  dietBlockK: "",

};

// ─── Кнопки (підписи) ────────────────────────────────────────────────────────
// Заповнювати тільки з logic.md.

export const PATIENT_QUICK_REPLIES = {
  questionResolved: "Питання вирішено. Розпочати!",
  dietConfirm: "",
};

// ─── UI-мітки (не є повідомленнями асистента пацієнту) ───────────────────────

export function getTimeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Доброго ранку";
  if (hour >= 12 && hour < 18) return "Доброго дня";
  return "Доброго вечора";
}

export const AI_SUMMARY_BY_STATUS = {
  planning: "Записаний на процедуру, очікує підготовки",
  progress: "Підготовка триває, асистент веде пацієнта",
  yellow:   "Підготовка активна, обрано препарат",
  risk:     "Пацієнт має запитання, потрібна відповідь лікаря",
  ready:    "Підготовка завершена, пацієнт допущений",
} as const;

export const AI_SUMMARY_DEFAULTS = {
  withAiPrep: "Асистент надсилає інструкції...",
  withoutAiPrep: "Очікує підготовки",
  afterDoctorReply: "Лікар відповів у чаті, очікуємо реакцію пацієнта",
  fromCalendar: "Дані з календаря",
  trainingEntry: "Тренувальна запис",
  rescheduled: "Очікує підготовки",
} as const;

export const EVENT_LOG_LABELS = {
  cardOpened:        (date: string) => `Картку відкрито · ${date}`,
  welcomeSent:       "Вітальне повідомлення надіслано",
  dietSent:          "Інструкція щодо харчування надіслана",
  waitingForPatient: "Очікування підтвердження пацієнта",
  patientConfirmed:  "Пацієнт підтвердив готовність",
  patientHasQuestion:"Пацієнт має запитання",
  rescheduled:       (fromDate: string) => `Підготовку перезапущено (перенос з ${fromDate})`,
  waitingForAction:  "Очікування наступної дії пацієнта",
};

export const ALERT_PANEL = {
  titleWithUnclosed: "У вас є незавершені прийоми, що потребують уваги",
  titleDefault:      "Асистент: потрібна увага",
  emptyState:        "Наразі немає звернень, що потребують відповіді лікаря.",
  showMore:          (count: number) => `Показати ще (${count})`,
  dateBadge: {
    today:    "СЬОГОДНІ",
    tomorrow: "ЗАВТРА",
  },
  senderLabels: {
    patient: "Клієнт",
    doctor:  "Лікар",
    ai:      "Асистент",
  },
  card: {
    expandBtn:        "Відповісти",
    collapseBtn:      "Згорнути",
    lastMessages:     "Останні повідомлення:",
    replyTitle:       "Відповідь лікаря пацієнту",
    replyPlaceholder: "Відповідь лікаря пацієнту...",
    quickReplyBtn:    "Швидка відповідь: після 19:00",
    callIdle:         "Позвонить",
    callConnecting:   "Підключення...",
  },
  busyTemplate: (phone?: string) =>
    phone
      ? `Я зараз зайнятий. Передзвоніть мені, будь ласка, після 19:00 на мій телефон: ${phone}.`
      : "Я зараз зайнятий. Передзвоніть мені, будь ласка, після 19:00.",
};

export const UNCLOSED_VISIT_MODAL = {
  bannerTitle:     "Незакритий прийом",
  modalTitle:      "Закрити прийом",
  modalSubtitle:   "Оберіть дію для цього прийому.",
  protocolFilled:  "Висновок заповнено. Тепер ви можете завершити візит.",
  protocolEmpty:   "Висновок лікаря ще не заповнено!",
  btnComplete:     "Завершити процедуру",
  btnFillProtocol: "Заповнити протокол",
  btnNoShow:       "Пацієнт не з'явився",
};

export const REPLY_MODAL_QUICK_ACTIONS = [
  "Так, можна",
  "Ні, замініть на…",
  "Зателефонуйте в клініку",
];

export const REPLY_MODAL_LABELS = {
  appointmentBanner:    "Процедура призначена на:",
  unansweredLabel:      "Питання без відповіді",
  patientSenderLabel:   "Пацієнт",
  assistantSenderLabel: "Асистент",
  replyPlaceholder:     "Ваша відповідь…",
};

export const TOAST_MESSAGES = {
  entryCreated:  (name: string, time: string) => `Запис створено: ${name} о ${time}`,
  aiPrepStarted: "Асистент розпочав підготовку",
  replySent:     (name?: string) => `Відповідь надіслано пацієнту${name ? `: ${name}` : ""}`,
};

export const BANNER_LABELS = {
  overdueBanner:  "У вас є незавершені прийоми за минулі дні",
  overdueSection: "Незавершені за минулі дні",
};

export const NO_SHOW_ANNOTATION = "🚫 Прийом аннульовано (неявка пацієнта)";
