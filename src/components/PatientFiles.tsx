import { useState, useRef, useEffect, useMemo } from "react";
import imageCompression from "browser-image-compression";
import { X, FileText, Upload, Eye, Trash2, FileImage, Link, Play, ChevronRight, ChevronDown, Loader2, Pencil, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";
import { uploadFileToSupabaseStorage, deleteFileFromSupabaseStorage, resolveVisitFilePublicUrl, refreshStorageSignedUrl } from "@/lib/supabaseSync";
import { toast } from "sonner";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// ── Local date utilities (mirrors PatientDetailView) ──

function getTodayIsoKyiv(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kiev" }).format(new Date());
}

function isoToDisplay(isoDate?: string, fallback?: string): string {
  const parts = isoDate?.split("-");
  if (parts?.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
  return fallback || isoDate || "";
}

function displayToIso(displayDate?: string): string {
  const parts = displayDate?.split(".");
  if (parts?.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return "";
}

function formatDateUkrainian(ddmmyyyy: string): string {
  const months = ["січня","лютого","березня","квітня","травня","червня","липня","серпня","вересня","жовтня","листопада","грудня"];
  const [d, m, y] = ddmmyyyy.split(".");
  if (!d || !m || !y) return ddmmyyyy;
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1] ?? ""} ${y}`;
}

const RESCHEDULED_MARKER = "__RESCHEDULED_TO__:";

// ── Types ──

export type FileItem = {
  id: string;
  name: string;
  type: "doctor" | "patient";
  date: string;
  url?: string;
  storageKey?: string;
  mimeType?: string;
  kind?: "video-link";   // external video URL (YouTube, Drive, iCloud, etc.)
};

type PreviewState =
  | { kind: "pdf"; name: string; blob: Blob; url?: string }
  | { kind: "docx"; name: string; blob: Blob }
  | { kind: "image"; name: string; url: string }   // URL-based — no blob fetch needed
  | { kind: "unsupported"; name: string; message: string };

// ── IndexedDB blob storage ──

const FILE_DB_NAME = "proctocare_files";
const FILE_STORE_NAME = "files";

function openFileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FILE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILE_STORE_NAME)) {
        db.createObjectStore(FILE_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putBlobToStorage(key: string, blob: Blob): Promise<void> {
  const db = await openFileDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE_NAME, "readwrite");
    tx.objectStore(FILE_STORE_NAME).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getBlobFromStorage(key: string): Promise<Blob | null> {
  const db = await openFileDb();
  const result = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE_NAME, "readonly");
    const req = tx.objectStore(FILE_STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as Blob) || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

async function deleteBlobFromStorage(key: string): Promise<void> {
  const db = await openFileDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILE_STORE_NAME, "readwrite");
    tx.objectStore(FILE_STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// ── Helper: pick icon by file type ──
function FileTypeIcon({ file }: { file: FileItem }) {
  if (file.kind === 'video-link') {
    return <Play size={15} className="text-violet-500 shrink-0" />;
  }
  const ext = (file.name.toLowerCase().split('.').pop() || '');
  const mime = (file.mimeType || '').toLowerCase();
  if (mime.includes('pdf') || ext === 'pdf') {
    return <FileText size={15} className="text-red-500 shrink-0" />;
  }
  if (mime.startsWith('image/') || ['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) {
    return <FileImage size={15} className="text-emerald-500 shrink-0" />;
  }
  if (mime.includes('officedocument') || mime.includes('msword') || ['doc','docx'].includes(ext)) {
    return <FileText size={15} className="text-blue-500 shrink-0" />;
  }
  return <FileText size={15} className={file.type === 'doctor' ? 'text-primary shrink-0' : 'text-status-progress shrink-0'} />;
}

// ── Shared file row ──
function FileRow({ file, onDelete, onView, readOnly }: { file: FileItem; onDelete: () => void; onView: () => void; readOnly?: boolean }) {
  const subtitle = file.kind === 'video-link'
    ? `Відео · ${file.date}`
    : `${file.type === "doctor" ? "Лікар" : "Пацієнт"} · ${file.date}`;
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-background border border-border/60">
      <FileTypeIcon file={file} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-foreground truncate">{file.name}</p>
        <p className="text-[10px] text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={onView}
          className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-accent active:scale-[0.9] transition-all" title="Переглянути">
          <Eye size={12} className="text-muted-foreground" />
        </button>
        {!readOnly && (
          <button onClick={onDelete}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-red-50 text-destructive/70 hover:text-destructive active:scale-[0.9] transition-all" title="Видалити">
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function PdfPreviewModal({ file, onClose }: { file: { name: string; blob: Blob; url?: string }; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [scale, setScale] = useState(1.1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const renderTaskRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: ReturnType<typeof getDocument> | null = null;

    setLoading(true);
    setError(null);
    setPdfDoc(null);
    setPage(1);
    setPages(0);

    (async () => {
      try {
        const bytes = new Uint8Array(await file.blob.arrayBuffer());
        loadingTask = getDocument({
          data: bytes,
          useSystemFonts: true,
          isEvalSupported: false,
          enableXfa: false,
        });
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setPages(doc.numPages || 0);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error("PDF open failed", e);
        setError("Не вдалося відкрити PDF для перегляду");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (loadingTask) {
        try { loadingTask.destroy(); } catch { }
      }
    };
  }, [file.blob]);

  useEffect(() => {
    if (!pdfDoc) return;

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        if (renderTaskRef.current) {
          try { renderTaskRef.current.cancel(); } catch { }
        }

        const currentPage = await pdfDoc.getPage(page);
        if (cancelled) return;

        const viewport = currentPage.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const renderTask = currentPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (!cancelled) setLoading(false);
      } catch (e) {
        const errorName = typeof e === "object" && e !== null && "name" in e ? String((e as { name?: string }).name) : "";
        if (!cancelled && errorName !== "RenderingCancelledException") {
          console.error("PDF render failed", e);
          setError("Не вдалося відкрити PDF для перегляду");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch { }
      }
    };
  }, [pdfDoc, page, scale]);

  useEffect(() => {
    return () => {
      if (pdfDoc) {
        try { pdfDoc.destroy(); } catch { }
      }
    };
  }, [pdfDoc]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-card w-full max-w-6xl h-[90vh] rounded-xl shadow-elevated overflow-hidden border border-border/60 flex flex-col">
        <div className="h-12 px-3 border-b border-border/60 flex items-center gap-2 shrink-0">
          <p className="text-sm font-bold text-foreground truncate pr-2 flex-1">{file.name}</p>

          <button
            onClick={() => setScale((s) => Math.max(0.7, +(s - 0.1).toFixed(2)))}
            className="px-2 py-1 text-xs font-bold rounded border border-border hover:bg-accent"
            title="Зменшити"
          >
            -
          </button>
          <span className="text-xs font-semibold text-muted-foreground w-12 text-center">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale((s) => Math.min(2.5, +(s + 0.1).toFixed(2)))}
            className="px-2 py-1 text-xs font-bold rounded border border-border hover:bg-accent"
            title="Збільшити"
          >
            +
          </button>

          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading || !!error}
            className="px-2 py-1 text-xs font-bold rounded border border-border hover:bg-accent disabled:opacity-40"
          >
            Назад
          </button>
          <span className="text-xs font-semibold text-muted-foreground min-w-16 text-center">{pages > 0 ? `${page}/${pages}` : "0/0"}</span>
          <button
            onClick={() => setPage((p) => Math.min(pages || 1, p + 1))}
            disabled={loading || !!error || pages === 0 || page >= pages}
            className="px-2 py-1 text-xs font-bold rounded border border-border hover:bg-accent disabled:opacity-40"
          >
            Вперед
          </button>

          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-accent transition-colors"
            title="Закрити перегляд"
          >
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-muted/30 p-4">
          {error ? (
            <div className="h-full flex items-center justify-center text-sm text-destructive font-semibold">{error}</div>
          ) : (
            <div className="relative min-h-full flex justify-center items-start">
              <canvas
                ref={canvasRef}
                className={cn("bg-white rounded shadow-md max-w-full h-auto", loading ? "opacity-0" : "opacity-100")}
              />
              {loading ? (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Завантаження PDF...</div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ImagePreviewModal({ file, onClose }: { file: { name: string; url: string }; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    // z-[200] — above all modals (PatientDetailView z-50, confirm dialogs z-[70], other previews z-[80])
    <div
      className="fixed inset-0 z-[200] bg-black/90 flex flex-col animate-fade-in"
      onClick={onClose}
    >
      <div
        className="shrink-0 flex items-center justify-between px-4 py-3 bg-black/50 backdrop-blur-sm"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-white truncate pr-4 flex-1">{file.name}</p>
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/30 transition-colors"
          title="Закрити"
        >
          <X size={18} className="text-white" />
        </button>
      </div>
      <div
        className="flex-1 overflow-auto flex items-center justify-center p-2"
        onClick={e => e.stopPropagation()}
      >
        <img
          src={file.url}
          alt={file.name}
          className="max-w-full max-h-full object-contain select-none"
          style={{ touchAction: 'pinch-zoom' }}
          draggable={false}
        />
      </div>
    </div>
  );
}

function DocxPreviewModal({ file, onClose }: { file: { name: string; blob: Blob }; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const arrayBuffer = await file.blob.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (cancelled) return;
        setHtml(result.value);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error("DOCX preview failed", e);
        setError("Не вдалося відкрити Word-документ для перегляду");
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file.blob]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-card w-full max-w-5xl h-[90vh] rounded-xl shadow-elevated overflow-hidden border border-border/60 flex flex-col">
        <div className="h-12 px-3 border-b border-border/60 flex items-center gap-2 shrink-0">
          <p className="text-sm font-bold text-foreground truncate pr-2 flex-1">{file.name}</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-accent transition-colors" title="Закрити перегляд">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-muted/20 p-6">
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">Завантаження документа...</div>
          ) : error ? (
            <div className="h-full flex items-center justify-center text-sm text-destructive font-semibold">{error}</div>
          ) : (
            <article className="mx-auto max-w-3xl bg-white rounded-lg shadow-sm p-8 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      </div>
    </div>
  );
}

function UnsupportedPreviewModal({ name, message, onClose }: { name: string; message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-card w-full max-w-xl rounded-xl shadow-elevated overflow-hidden border border-border/60 flex flex-col">
        <div className="h-12 px-3 border-b border-border/60 flex items-center gap-2 shrink-0">
          <p className="text-sm font-bold text-foreground truncate pr-2 flex-1">{name}</p>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-accent transition-colors" title="Закрити перегляд">
            <X size={16} className="text-muted-foreground" />
          </button>
        </div>
        <div className="p-6 text-sm text-foreground leading-relaxed">{message}</div>
      </div>
    </div>
  );
}

// ── Clinical Timeline: groups documents & files by appointment date ──
export function PatientFiles({ files, onFilesChange, onFocusEdit, fromForm, protocolText, archivedProtocolText, protocolHistory, procedureHistory, historicalVisitDates, visitOutcomeByDate, currentVisitOutcome, activeVisitDate, onProtocolPrefill, visitId, relatedFiles, onDateClick }: {
  files: FileItem[];
  onFilesChange: (files: FileItem[]) => void;
  onFocusEdit: (field: string, value: string) => void;
  fromForm?: boolean;
  protocolText: string;
  /** Raw saved protocol from DB for the completed visit — used for archive block and copy button. */
  archivedProtocolText?: string;
  protocolHistory?: Array<{ value: string; timestamp: string; date: string }>;
  procedureHistory?: Array<{ value: string; timestamp: string; date: string }>;
  historicalVisitDates?: string[];
  visitOutcomeByDate?: Record<string, "completed" | "no-show">;
  currentVisitOutcome?: "completed" | "no-show";
  activeVisitDate: string;
  onProtocolPrefill: (value: string) => void;
  visitId?: string;
  /** Read-only files from related past visits — shown in archive section only, never saved to current visit. */
  relatedFiles?: FileItem[];
  /** If provided, historical visit date headers become clickable links to open that visit's card */
  onDateClick?: (displayDate: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<string | null>(null);
  const [confirmCopyProtocol, setConfirmCopyProtocol] = useState<{ value: string; date: string } | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showVideoInput, setShowVideoInput] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoName, setVideoName] = useState('');
  const [expandedProtocols, setExpandedProtocols] = useState<Set<string>>(new Set());

  const activeDate = activeVisitDate || isoToDisplay(getTodayIsoKyiv());

  // Group files by their date field.
  // relatedFiles are read-only (from other visits) and only appear in the archive.
  const filesByDate = useMemo(() => {
    const map = new Map<string, FileItem[]>();
    for (const f of [...files, ...(relatedFiles || [])]) {
      const d = f.date || activeDate;
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(f);
    }
    return map;
  }, [files, relatedFiles, activeDate]);

  // Set of dates that belong to definitively closed past visits.
  // Only dates in this set can trigger archiving of files.
  const pastVisitDateSet = useMemo(() => {
    const s = new Set<string>();
    for (const d of (historicalVisitDates || [])) s.add(d);
    for (const d of Object.keys(visitOutcomeByDate || {})) s.add(d);
    // When the current visit itself is closed, also treat activeDate as a past visit
    // so its files correctly move into the archive section.
    if (currentVisitOutcome) s.add(activeDate);
    return s;
  }, [historicalVisitDates, visitOutcomeByDate, currentVisitOutcome, activeDate]);

  // Map protocolHistory ISO dates → { displayDate: DD.MM.YYYY, value }
  const protocolByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of (protocolHistory || [])) {
      if (h.value.startsWith(RESCHEDULED_MARKER)) continue;
      const parts = h.date?.split("-");
      if (parts?.length === 3) {
        const dd = `${parts[2]}.${parts[1]}.${parts[0]}`;
        map.set(dd, h.value);
      }
    }
    // For completed visits: if there is no protocolHistory entry for the active date,
    // fall back to archivedProtocolText (raw visits.protocol from DB) so the archive
    // section shows the text immediately without needing a protocol_history column.
    const archiveFallback = archivedProtocolText?.trim() || protocolText?.trim();
    if (currentVisitOutcome && archiveFallback && !map.has(activeDate)) {
      map.set(activeDate, archiveFallback);
    }
    return map;
  }, [protocolHistory, currentVisitOutcome, protocolText, archivedProtocolText, activeDate]);

  const rescheduledToByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of (protocolHistory || [])) {
      if (!h.value.startsWith(RESCHEDULED_MARKER)) continue;
      const parts = h.date?.split("-");
      if (parts?.length === 3) {
        const dd = `${parts[2]}.${parts[1]}.${parts[0]}`;
        const targetIso = h.value.replace(RESCHEDULED_MARKER, "");
        map.set(dd, isoToDisplay(targetIso));
      }
    }
    return map;
  }, [protocolHistory]);

  const latestArchivedProtocol = useMemo(() => {
    const isCompleted = !!currentVisitOutcome;
    const entries = (protocolHistory || [])
      .filter((h) => !h.value.startsWith(RESCHEDULED_MARKER))
      .filter((h) => {
        const parts = h.date?.split("-");
        if (parts?.length !== 3) return false;
        const dd = `${parts[2]}.${parts[1]}.${parts[0]}`;
        // ONLY include entries from definitively closed visits (completed or no-show).
        // Planning/scheduled visits — even if their date is in the future — are excluded.
        // visitOutcomeByDate contains exactly those closed past dates.
        if ((visitOutcomeByDate || {})[dd] !== undefined) return true;
        // When the current open card is itself a completed/no-show visit, include its entries too.
        if (isCompleted && dd === activeDate) return true;
        return false;
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    // For completed visits: if the protocol text exists but isn't yet in history,
    // surface it directly so the copy button appears immediately after closing the visit.
    // Prefer archivedProtocolText (raw DB value) over protocolText (live editable state).
    const archiveSource = (archivedProtocolText?.trim() || protocolText?.trim());
    if (isCompleted && archiveSource) {
      const activeIso = displayToIso(activeDate);
      const hasEntryForActive = entries.some((e) => e.date === activeIso);
      if (!hasEntryForActive) {
        // Find the actual date of this protocol text in full history (don't use activeDate
        // blindly — it could be a future reschedule date that doesn't match the source text).
        const allNonMarkers = (protocolHistory || [])
          .filter((h) => !h.value.startsWith(RESCHEDULED_MARKER))
          .sort((a, b) => b.date.localeCompare(a.date));
        const matchingEntry = allNonMarkers.find((e) => e.value.trim() === archiveSource.trim());
        const fallbackDate = matchingEntry ? isoToDisplay(matchingEntry.date) : activeDate;
        return { value: archiveSource, date: fallbackDate };
      }
    }

    const latest = entries[0];
    if (!latest) return null;
    return {
      value: latest.value,
      date: isoToDisplay(latest.date),
    };
  }, [protocolHistory, activeDate, currentVisitOutcome, protocolText, visitOutcomeByDate]);

  const procedureByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of (procedureHistory || [])) {
      const parts = h.date?.split("-");
      if (parts?.length === 3) {
        const dd = `${parts[2]}.${parts[1]}.${parts[0]}`;
        map.set(dd, h.value);
      }
    }
    return map;
  }, [procedureHistory]);

  // Collect all historical dates (not active), sorted descending.
  // File dates are only included if they belong to a definitively closed past visit.
  const historicalDates = useMemo(() => {
    const dates = new Set<string>();
    // Only add a file's date to history if it's a known past closed visit date
    for (const d of filesByDate.keys()) if (d !== activeDate && pastVisitDateSet.has(d)) dates.add(d);
    for (const d of protocolByDate.keys()) if (d !== activeDate && pastVisitDateSet.has(d)) dates.add(d);
    for (const d of procedureByDate.keys()) if (d !== activeDate && pastVisitDateSet.has(d)) dates.add(d);
    for (const d of rescheduledToByDate.keys()) if (d !== activeDate) dates.add(d);
    for (const d of (historicalVisitDates || [])) if (d !== activeDate) dates.add(d);
    for (const d of Object.keys(visitOutcomeByDate || {})) if (d !== activeDate) dates.add(d);
    if (currentVisitOutcome) dates.add(activeDate);
    return Array.from(dates).sort((a, b) => {
      const parse = (s: string) => {
        const [d, m, y] = s.split(".");
        return new Date(+y, +m - 1, +d).getTime();
      };
      return parse(b) - parse(a);
    });
  }, [filesByDate, protocolByDate, procedureByDate, rescheduledToByDate, historicalVisitDates, visitOutcomeByDate, currentVisitOutcome, activeDate, pastVisitDateSet]);

  // All historical dates start collapsed
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(() => new Set(historicalDates));

  useEffect(() => {
    setCollapsedDates(new Set(historicalDates));
  }, [historicalDates]);

  const toggleDate = (date: string) => {
    setCollapsedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  // For completed visits fields.protocol == patient.protocol (synced above),
  // so activeProtocolText naturally reflects whatever is in the DB.
  // The active block shows the saved conclusion; the copy button allows prefilling from history.
  const activeProtocolText = protocolText;
  // Include all files NOT belonging to a definitively closed past visit,
  // regardless of whether their date matches activeDate (handles rescheduled visits).
  const activeFiles = currentVisitOutcome ? [] : files.filter(f => !pastVisitDateSet.has(f.date || activeDate));

  const getFileExtension = (name: string): string => {
    const parts = name.toLowerCase().trim().split(".");
    return parts.length > 1 ? (parts.at(-1) || "").trim() : "";
  };

  const inferMimeFromName = (name: string): string => {
    const ext = getFileExtension(name);
    if (ext === "pdf") return "application/pdf";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (ext === "doc") return "application/msword";
    return "application/octet-stream";
  };

  const looksLikePdfBlob = async (blob: Blob): Promise<boolean> => {
    try {
      const head = await blob.slice(0, 5).text();
      return head === "%PDF-";
    } catch {
      return false;
    }
  };
  void looksLikePdfBlob; // suppress unused warning — kept for future use

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setIsUploading(true);

    try {
      const uploaded = await Promise.all(Array.from(e.target.files).map(async (file) => {
        const storageKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`;

        // Compress images before upload
        let fileToUpload: File = file;
        if (file.type.startsWith('image/')) {
          try {
            const compressed = await imageCompression(file, {
              maxSizeMB: 1,
              maxWidthOrHeight: 1920,
              useWebWorker: true,
            });
            // Always keep the original MIME type: compressed.type can be '' in some browsers
            const explicitType = file.type || inferMimeFromName(file.name);
            fileToUpload = new File([compressed], file.name, { type: explicitType });
            if (fileToUpload.size === 0) {
              console.error('[FileUpload] ✗ compression produced empty blob, using original');
              fileToUpload = file;
            }
          } catch (compressErr) {
            console.warn('[FileUpload] compression failed, using original:', compressErr);
            fileToUpload = file;
          }
        } else {
          // PDF / TXT / DOC — skip compressor entirely
        }

        // Validate before upload
        if (fileToUpload.size === 0) {
          throw new Error(`Файл порожній (0 байт): ${file.name}`);
        }

        // Try Supabase Storage first (cross-device access)
        let publicUrl: string | undefined;
        if (visitId) {
          const url = await uploadFileToSupabaseStorage(visitId, fileToUpload);
          if (url) {
            publicUrl = url;
          } else {
            console.warn('[FileUpload] ⚠️ Supabase returned null — file will be local only (check [Storage] errors above)');
          }
        } else {
          console.warn('[FileUpload] ⚠️ visitId is empty — Supabase upload skipped');
        }

        // Always keep IndexedDB copy as local cache / offline fallback
        // NOTE: IndexedDB is non-fatal — Supabase Storage is the source of truth
        try {
          await putBlobToStorage(storageKey, fileToUpload);
        } catch (idbErr) {
          console.warn('[FileUpload] ⚠️ IndexedDB save failed (non-fatal, file is in Supabase):', idbErr);
        }

        return {
          id: Math.random().toString(36).substring(7),
          name: file.name,
          type: "doctor" as const,
          date: activeDate,
          storageKey,
          url: publicUrl,
          mimeType: file.type || inferMimeFromName(file.name),
        } as FileItem;
      }));

      onFilesChange([...files, ...uploaded]);
    } catch (err) {
      console.error('[FileUpload] ✗ outer catch fired — full error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Не вдалося зберегти файл: ${msg}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSaveVideoLink = () => {
    const trimUrl = videoUrl.trim();
    if (!trimUrl) { toast.error('Введіть посилання на відео'); return; }
    try { new URL(trimUrl); } catch {
      toast.error('Невалідне посилання. Переконайтесь, що URL починається з https://');
      return;
    }
    const label = videoName.trim() || 'Відео матеріали';
    const newItem: FileItem = {
      id: Math.random().toString(36).substring(7),
      name: label,
      type: 'doctor',
      date: activeDate,
      url: trimUrl,
      kind: 'video-link',
    };
    onFilesChange([...files, newItem]);
    setVideoUrl('');
    setVideoName('');
    setShowVideoInput(false);
    toast.success('Посилання збережено');
  };

  const handleViewFile = async (file: FileItem) => {
    // ── video-link → open directly in new tab ──
    if (file.kind === 'video-link') {
      if (file.url) {
        window.open(file.url, '_blank', 'noopener,noreferrer');
      } else {
        toast.error('Посилання відсутнє');
      }
      return;
    }
    try {
      const ext = getFileExtension(file.name);
      const mime = (file.mimeType || '').toLowerCase();
      const isPdf   = mime.includes('pdf') || ext === 'pdf';
      const isImage = mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext);
      const isDocx  = mime.includes('officedocument.wordprocessingml.document') || ext === 'docx';

      // ── Step 1: resolve the best URL available ──
      // For Supabase files always generate a fresh signed URL — stored URLs may be
      // expired public URLs (pre-migration) or expired signed URLs (900s TTL).
      let viewUrl: string | undefined;
      if (file.url?.includes('/storage/v1/object/') && visitId) {
        viewUrl = (await refreshStorageSignedUrl(file.url)) ?? undefined;
      }
      if (!viewUrl && visitId) {
        viewUrl = (await resolveVisitFilePublicUrl(visitId, file.name)) ?? undefined;
      }
      if (!viewUrl) {
        viewUrl = file.url;
      }

      // ── PDF → always open in new browser tab (most reliable on iOS/Android/desktop) ──
      // Never use setPreview for PDFs — canvas renderer causes grey screen on mobile.
      if (isPdf) {
        let urlToOpen = viewUrl;
        if (!urlToOpen && file.storageKey) {
          // Fallback: local IndexedDB blob → object URL (current session only)
          const blob = await getBlobFromStorage(file.storageKey).catch(() => null);
          if (blob) {
            urlToOpen = URL.createObjectURL(blob);
          } else {
            console.warn('[handleViewFile] ⚠️ blob NOT found in IndexedDB for key:', file.storageKey);
          }
        }
        if (urlToOpen) {
          const newWindow = window.open(urlToOpen, '_blank', 'noopener,noreferrer');
          if (newWindow) newWindow.focus();
          return;
        }
        // Both Supabase URL and IndexedDB empty — file was from a previous session without cloud upload
        console.error('[handleViewFile] ✗ PDF has no URL and no local blob:', file);
        toast.error('PDF недоступний. Файл збережений лише локально у попередній сесії. Видаліть і завантажте знову.', { duration: 6000 });
        return;
      }

      // ── Image → Lightbox (URL-based, no fetch/blob download needed) ──
      if (isImage) {
        if (viewUrl) {
          setPreview({ kind: 'image', name: file.name, url: viewUrl });
          return;
        }
        // Fallback: local blob → object URL
        const blob = await getBlobFromStorage(file.storageKey ?? '').catch(() => null);
        if (blob) {
          setPreview({ kind: 'image', name: file.name, url: URL.createObjectURL(blob) });
          return;
        }
        toast.error('Зображення недоступне. Спробуйте завантажити повторно.');
        return;
      }

      // ── DOCX → blob → mammoth renderer ──
      if (isDocx) {
        let blob: Blob | null = file.storageKey
          ? await getBlobFromStorage(file.storageKey).catch(() => null)
          : null;
        if (!blob && viewUrl) {
          try {
            const res = await fetch(viewUrl, { cache: 'no-store' });
            if (res.ok) blob = await res.blob();
          } catch { /* silent */ }
        }
        if (blob) { setPreview({ kind: 'docx', name: file.name, blob }); return; }
        setPreview({ kind: 'unsupported', name: file.name, message: 'Не вдалося завантажити DOCX для перегляду. Спробуйте ще раз.' }); return;
      }

      // ── .doc (legacy binary) ──
      if ((mime.includes('msword') || ext === 'doc')) {
        setPreview({ kind: 'unsupported', name: file.name, message: 'Формат .doc є застарілим. Збережіть як .docx, і він відкриється прямо всередині додатку.' }); return;
      }

      setPreview({ kind: 'unsupported', name: file.name, message: 'Цей формат не підтримується. Доступні: PDF, зображення (JPG/PNG/WebP), DOCX.' });
    } catch (err) {
      console.error('[handleViewFile] ✗ unexpected error:', err);
      toast.error('Не вдалося відкрити файл. Спробуйте ще раз.');
    }
  };

  return (
    <div className="pb-4 relative">
      {preview?.kind === "pdf" && <PdfPreviewModal file={preview} onClose={() => setPreview(null)} />}
      {preview?.kind === "image" && <ImagePreviewModal file={preview} onClose={() => setPreview(null)} />}
      {preview?.kind === "docx" && <DocxPreviewModal file={preview} onClose={() => setPreview(null)} />}
      {preview?.kind === "unsupported" && <UnsupportedPreviewModal name={preview.name} message={preview.message} onClose={() => setPreview(null)} />}

      {/* Delete confirmation dialog */}
      {confirmDeleteFile && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/20 backdrop-blur-sm animate-fade-in" onClick={() => setConfirmDeleteFile(null)}>
          <div className="bg-surface-raised rounded-xl shadow-elevated p-5 mx-4 max-w-sm w-full animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-foreground mb-1">Видалити файл?</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Ви впевнені, що хочете видалити файл «{files.find(f => f.id === confirmDeleteFile)?.name}»?
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setConfirmDeleteFile(null)} className="flex-1 py-2.5 text-sm font-bold text-muted-foreground border border-border rounded-lg hover:bg-muted/40 transition-colors active:scale-[0.97]">Скасувати</button>
              <button onClick={async () => {
                const fileToDelete = files.find((x) => x.id === confirmDeleteFile);
                if (fileToDelete?.storageKey) {
                  try {
                    await deleteBlobFromStorage(fileToDelete.storageKey);
                  } catch (err) {
                    console.error("Failed to delete file from local storage", err);
                  }
                }
                if (fileToDelete?.url) {
                  void deleteFileFromSupabaseStorage(fileToDelete.url);
                }
                onFilesChange(files.filter(x => x.id !== confirmDeleteFile));
                setConfirmDeleteFile(null);
              }}
                className="flex-1 py-2.5 text-sm font-bold bg-destructive text-destructive-foreground rounded-lg transition-colors active:scale-[0.97]">Видалити</button>
            </div>
          </div>
        </div>
      )}

      {confirmCopyProtocol && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/20 backdrop-blur-sm animate-fade-in" onClick={() => setConfirmCopyProtocol(null)}>
          <div className="bg-surface-raised rounded-xl shadow-elevated p-5 mx-4 max-w-sm w-full animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-foreground mb-1">Замінити поточний висновок?</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Це замінить ваш поточний текст текстом від {confirmCopyProtocol.date}. Продовжити?
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setConfirmCopyProtocol(null)}
                className="flex-1 py-2.5 text-sm font-bold text-muted-foreground border border-border rounded-lg hover:bg-muted/40 transition-colors active:scale-[0.97]"
              >
                Скасувати
              </button>
              <button
                onClick={() => {
                  onProtocolPrefill(confirmCopyProtocol.value);
                  setConfirmCopyProtocol(null);
                  toast.success(`Висновок від ${confirmCopyProtocol.date} скопійовано`);
                }}
                className="flex-1 py-2.5 text-sm font-bold bg-status-ready text-white rounded-lg transition-colors active:scale-[0.97]"
              >
                Замінити
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="relative px-4">
        {/* ── Current Visit (active work zone — always visible, content empty when completed) ── */}
        <div className={cn("relative mb-4", currentVisitOutcome ? "pt-1" : "pl-8")}>
          {!currentVisitOutcome && (
            <div className="absolute left-0 top-[3px] w-3.5 h-3.5 rounded-full border-2 border-white shadow-sm bg-primary" />
          )}

          {/* Header — only shown for active (non-completed) visit */}
          {!currentVisitOutcome && (
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[11px] font-bold text-primary">{formatDateUkrainian(activeDate)}</span>
              {displayToIso(activeDate) < getTodayIsoKyiv() && (
                <span className="ml-auto text-[8px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full shrink-0 uppercase tracking-wide">⚠ Незавершений прийом</span>
              )}
            </div>
          )}

          {/* ВИСНОВОК ЛІКАРЯ — soft highlighted border, editable */}
          <div className="rounded-lg border-2 border-[hsl(204,100%,80%)] bg-[hsl(204,100%,97%)] p-3 space-y-2 mb-2.5 relative">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <FileText size={12} className="text-primary" />
                Висновок лікаря
              </h4>
              <div className="flex items-center gap-1">
                {/* Copy button — visible when there is archived data AND doctor hasn't typed manually yet */}
                {latestArchivedProtocol && !activeProtocolText.trim() && (
                  <button
                    onClick={() => {
                      if (activeProtocolText.trim()) {
                        // Field has content → show confirmation dialog
                        setConfirmCopyProtocol({ value: latestArchivedProtocol.value, date: latestArchivedProtocol.date });
                      } else {
                        // Field is empty → copy immediately, no confirmation
                        onProtocolPrefill(latestArchivedProtocol.value);
                        toast.success(`Висновок від ${latestArchivedProtocol.date} скопійовано`);
                      }
                    }}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 hover:bg-sky-100 rounded-md px-1.5 py-0.5 transition-colors shrink-0"
                    title={`Скопіювати висновок від ${latestArchivedProtocol.date}`}
                  >
                    <ClipboardList size={11} className="shrink-0" />
                    <span className="hidden sm:inline">Скопіювати</span>
                    <span>({latestArchivedProtocol.date})</span>
                  </button>
                )}
                <button onClick={() => onFocusEdit("protocol", activeProtocolText)}
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-accent active:scale-[0.9] transition-all">
                  <Pencil size={11} className="text-muted-foreground" />
                </button>
              </div>
            </div>
            {activeProtocolText ? (
              <button
                onClick={() => onFocusEdit("protocol", activeProtocolText)}
                className="w-full text-left text-sm leading-relaxed text-foreground line-clamp-3 hover:opacity-75 transition-opacity cursor-pointer"
              >
                {activeProtocolText}
              </button>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={() => onFocusEdit("protocol", "")}
                  className="text-sm leading-relaxed text-muted-foreground/40 italic text-left w-full hover:text-muted-foreground/60 transition-colors"
                >
                  Натисніть, щоб заповнити висновок...
                </button>
              </div>
            )}
          </div>

          {/* Files for today */}
          {activeFiles.length > 0 && (
            <div className="space-y-1.5 mb-2.5">
              {activeFiles.map(file => (
                <FileRow key={file.id} file={file}
                  onDelete={() => setConfirmDeleteFile(file.id)}
                  onView={() => handleViewFile(file)} />
              ))}
            </div>
          )}

          {/* Upload — current visit only */}
          <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple className="hidden"
            accept="image/*, .pdf, .doc, .docx, .xls, .xlsx, .txt" />

          {/* Two action buttons side by side */}
          <div className="flex gap-2">
            <button
              onClick={() => !isUploading && fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold text-primary bg-transparent border border-primary/30 hover:bg-primary/5 rounded-lg py-2 transition-colors active:scale-[0.97] disabled:opacity-60 disabled:pointer-events-none"
            >
              {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {isUploading ? "Завантаження..." : "Завантажити файл"}
            </button>
            <button
              onClick={() => { setShowVideoInput(v => !v); setVideoUrl(''); setVideoName(''); }}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold text-violet-600 bg-transparent border border-violet-300 hover:bg-violet-50 rounded-lg py-2 transition-colors active:scale-[0.97]"
            >
              <Link size={13} />
              Додати відео
            </button>
          </div>

          {/* Inline video-link form */}
          {showVideoInput && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 space-y-2 animate-fade-in">
              <p className="text-[11px] font-semibold text-violet-700">Посилання на відео</p>
              <input
                type="text"
                placeholder="Назва (необов'язково)"
                value={videoName}
                onChange={e => setVideoName(e.target.value)}
                className="w-full text-xs rounded-md border border-border/60 bg-background px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-violet-400"
              />
              <input
                type="url"
                placeholder="https://drive.google.com/..."
                value={videoUrl}
                onChange={e => setVideoUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveVideoLink()}
                className="w-full text-xs rounded-md border border-border/60 bg-background px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-violet-400"
                autoFocus
              />
              <div className="flex gap-2 pt-0.5">
                <button
                  onClick={() => { setShowVideoInput(false); setVideoUrl(''); setVideoName(''); }}
                  className="flex-1 py-1.5 text-xs font-bold text-muted-foreground border border-border rounded-lg hover:bg-muted/40 transition-colors"
                >
                  Скасувати
                </button>
                <button
                  onClick={handleSaveVideoLink}
                  className="flex-1 py-1.5 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors active:scale-[0.97]"
                >
                  Зберегти посилання
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Historical Visits (collapsible) ── */}
        {historicalDates.map((date) => {
          const isCollapsed = collapsedDates.has(date);
          const dateFiles = filesByDate.get(date) || [];
          const dateProtocol = protocolByDate.get(date);
          const dateProcedure = procedureByDate.get(date);
          const dateOutcome = date === activeDate ? currentVisitOutcome : visitOutcomeByDate?.[date];
          const rescheduledTo = rescheduledToByDate.get(date);
          const isFrozen = !!rescheduledTo;

          return (
            <div key={date} className="relative pl-8 mb-3">
              {/* Muted dot for past visit */}
              <div className="absolute left-0 top-[3px] w-3.5 h-3.5 rounded-full bg-muted-foreground/25 border-2 border-white" />

              {/* Collapsible header */}
              <div className="flex items-center gap-1.5 mb-1">
                <button onClick={() => toggleDate(date)}
                  className="flex-1 flex items-center gap-1.5 text-left group min-w-0">
                  <span className="text-[11px] font-semibold text-muted-foreground truncate">{formatDateUkrainian(date)}</span>
                  {isFrozen && (
                    <span className="text-[9px] font-bold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded-full uppercase tracking-wide shrink-0">Перенесено</span>
                  )}
                  <ChevronDown size={11} className={cn(
                    "ml-auto text-muted-foreground/50 transition-transform duration-200 shrink-0",
                    !isCollapsed && "rotate-180"
                  )} />
                </button>
                {onDateClick && (
                  <button
                    onClick={() => onDateClick(date)}
                    title="Відкрити картку цього візиту"
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-accent transition-colors"
                  >
                    <ChevronRight size={12} className="text-muted-foreground/60 hover:text-primary transition-colors" />
                  </button>
                )}
              </div>

              {/* Expanded content — read-only archive */}
              {!isCollapsed && (
                <div className={cn("space-y-1.5 pt-0.5 rounded-lg p-2", isFrozen && "bg-slate-100 border border-slate-200")}>
                  {isFrozen && (
                    <div className="rounded-lg border border-slate-300 bg-slate-50 p-2.5">
                      <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wide mb-1">Статус</p>
                      <p className="text-xs font-semibold text-slate-700">Перенесено: {rescheduledTo}</p>
                    </div>
                  )}
                  {dateOutcome === "no-show" && !isFrozen && (
                    <div className="rounded-lg p-2.5 border border-status-risk/35 bg-status-risk-bg">
                      <p className="text-[10px] font-bold text-status-risk uppercase tracking-wide mb-1">Статус</p>
                      <p className="text-xs font-semibold text-status-risk">Не з'явився на прийом</p>
                    </div>
                  )}
                  {dateOutcome === "completed" && !isFrozen && (
                    <div className="rounded-lg p-2.5 border border-emerald-200 bg-emerald-50">
                      <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide mb-1">Статус</p>
                      <p className="text-xs font-semibold text-emerald-800">Процедуру завершено</p>
                    </div>
                  )}
                  {dateProcedure && (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 p-2.5">
                      <p className="text-[10px] font-bold text-sky-700 uppercase tracking-wide mb-1">Послуга</p>
                      <p className="text-xs font-semibold text-sky-900">{dateProcedure}</p>
                    </div>
                  )}
                  {dateProtocol && (
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Висновок лікаря</p>
                      <p className={cn(
                        "text-xs leading-relaxed text-foreground/80",
                        !expandedProtocols.has(date) && "line-clamp-3"
                      )}>
                        {dateProtocol}
                      </p>
                      {(dateProtocol.split('\n').length > 3 || dateProtocol.length > 200) && (
                        <button
                          onClick={() => setExpandedProtocols(prev => {
                            const next = new Set(prev);
                            if (next.has(date)) next.delete(date); else next.add(date);
                            return next;
                          })}
                          className="mt-1.5 text-[10px] font-semibold text-sky-600 hover:text-sky-700 hover:underline transition-colors"
                        >
                          {expandedProtocols.has(date) ? "Згорнути" : "Читати далі..."}
                        </button>
                      )}
                    </div>
                  )}
                  {dateFiles.map(file => (
                    <FileRow key={file.id} file={file} readOnly
                      onDelete={() => setConfirmDeleteFile(file.id)}
                      onView={() => handleViewFile(file)} />
                  ))}
                  {!dateProtocol && dateFiles.length === 0 && !isFrozen && !dateOutcome && (
                    <p className="text-[11px] text-muted-foreground/40 italic">Немає записів</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
