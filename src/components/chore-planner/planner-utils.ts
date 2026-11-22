import { HomeAssistantServiceError } from '../../api/ha-rest';
import { normaliseName } from '../../api/planner-meta';

export function sameMinute(left: string | null | undefined, right: string | null | undefined) {
  const minute = (value: string | null | undefined): number | null => {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? Math.floor(timestamp / 60_000) : null;
  };
  return minute(left) === minute(right);
}

export function sameNames(left: string[] | undefined, right: string[]) {
  const normalize = (names: string[]) =>
    Array.from(new Set(names.map((name) => normaliseName(name)))).sort();
  return JSON.stringify(normalize(left ?? [])) === JSON.stringify(normalize(right));
}

export function sameDays(left: string[] | undefined, right: string[]) {
  const normalize = (days: string[]) =>
    Array.from(new Set(days.map((day) => day.trim().toLowerCase()))).sort();
  return JSON.stringify(normalize(left ?? [])) === JSON.stringify(normalize(right));
}

export function errorDiagnosticText(error: unknown): string {
  if (error instanceof HomeAssistantServiceError) return error.details;
  if (error instanceof Error) {
    const attachedDetails = (error as Error & { details?: unknown }).details;
    if (typeof attachedDetails === 'string') return attachedDetails;
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return typeof error === 'string' ? error : String(error);
}
