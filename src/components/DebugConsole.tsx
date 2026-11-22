import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bug, Check, ChevronDown, Copy, Trash2, X } from 'lucide-react';
import {
  clearDebugLog,
  getDebugLogSnapshot,
  recordDebugLog,
  setDebugCaptureEnabled,
  subscribeDebugLog,
} from '../api/debug-log';
import { useTranslation } from '../i18n';

export interface DebugConsoleProps {
  enabled: boolean;
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back for embedded browsers and non-secure contexts.
  }

  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, field.value.length);
  try {
    return document.execCommand('copy');
  } finally {
    field.remove();
  }
}

function copyableLog(entries: ReturnType<typeof getDebugLogSnapshot>): string {
  return entries
    .map((entry) => {
      const time = new Date(entry.timestamp).toISOString();
      const heading = `${time} [${entry.level.toUpperCase()}] ${entry.source}: ${entry.message}`;
      return entry.details ? `${heading}\n${entry.details}` : heading;
    })
    .join('\n\n');
}

export function DebugConsole({ enabled }: DebugConsoleProps) {
  const { t } = useTranslation();
  const entries = useSyncExternalStore(
    subscribeDebugLog,
    getDebugLogSnapshot,
    getDebugLogSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const followLogRef = useRef(true);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDebugCaptureEnabled(enabled);
    if (!enabled) return;

    const handleError = (event: ErrorEvent) => {
      recordDebugLog({
        level: 'error',
        source: 'Browser',
        message: event.message || 'Unhandled browser error',
        details: event.error instanceof Error ? event.error.stack ?? event.error.message : undefined,
      });
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      recordDebugLog({
        level: 'error',
        source: 'Browser',
        message: 'Unhandled promise rejection',
        details: reason instanceof Error ? reason.stack ?? reason.message : String(reason),
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [enabled]);

  useEffect(
    () => () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    },
    [],
  );

  useEffect(() => {
    const element = logRef.current;
    if (open && element && followLogRef.current) element.scrollTop = element.scrollHeight;
  }, [entries, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  if (!enabled) return null;

  const handleCopy = async () => {
    const success = await copyText(copyableLog(entries));
    setCopied(success);
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    if (success) {
      copyResetRef.current = setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div className={`debug-console${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="debug-console-tab"
        onClick={() =>
          setOpen((value) => {
            if (!value) followLogRef.current = true;
            return !value;
          })
        }
        aria-expanded={open}
        aria-controls="debug-console-panel"
        aria-label={open ? t('debugConsole.close') : t('debugConsole.open')}
      >
        <Bug size={15} aria-hidden="true" />
        <span>{t('debugConsole.tab')}</span>
        {entries.length > 0 && <span className="debug-console-count">{entries.length}</span>}
        <ChevronDown className="debug-console-chevron" size={15} aria-hidden="true" />
      </button>

      <section
        className="debug-console-panel"
        id="debug-console-panel"
        aria-label={t('debugConsole.title')}
        aria-hidden={!open}
      >
        <header className="debug-console-header">
          <div className="debug-console-heading">
            <h2>{t('debugConsole.title')}</h2>
            <span>{entries.length}</span>
          </div>
          <div className="debug-console-actions">
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={entries.length === 0}
              aria-label={copied ? t('debugConsole.copied') : t('debugConsole.copy')}
              title={copied ? t('debugConsole.copied') : t('debugConsole.copy')}
            >
              {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              <span>{copied ? t('debugConsole.copied') : t('debugConsole.copy')}</span>
            </button>
            <button
              type="button"
              onClick={clearDebugLog}
              disabled={entries.length === 0}
              aria-label={t('debugConsole.clear')}
              title={t('debugConsole.clear')}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('common.close')}
              title={t('common.close')}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div
          className="debug-console-log"
          ref={logRef}
          role="log"
          aria-live="polite"
          onScroll={(event) => {
            const element = event.currentTarget;
            followLogRef.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 40;
          }}
        >
          {entries.length === 0 ? (
            <p className="debug-console-empty">{t('debugConsole.empty')}</p>
          ) : (
            entries.map((entry) => (
              <article className={`debug-console-entry is-${entry.level}`} key={entry.id}>
                <div className="debug-console-entry-meta">
                  <time dateTime={new Date(entry.timestamp).toISOString()}>
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </time>
                  <span>{entry.source}</span>
                </div>
                <p>{entry.message}</p>
                {entry.details && <pre>{entry.details}</pre>}
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
