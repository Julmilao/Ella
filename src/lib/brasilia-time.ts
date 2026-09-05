export const BRASILIA_TIME_ZONE = "America/Sao_Paulo";

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatBrasiliaDate(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRASILIA_TIME_ZONE,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...options,
  }).format(toDate(value));
}

export function formatBrasiliaTime(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRASILIA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...options,
  }).format(toDate(value));
}

export function formatBrasiliaDateTime(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: BRASILIA_TIME_ZONE,
    dateStyle: "short",
    timeStyle: "medium",
    ...options,
  }).format(toDate(value));
}
