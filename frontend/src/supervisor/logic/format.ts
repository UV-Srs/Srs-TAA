/**
 * Name and time formatting, ported from the LotSure prototype.
 * The prototype stores times as en-IN strings ("19 Aug 2026, 05:55 pm") and its helpers
 * work on those strings; protoTime() produces the same strings from our ISO times so the
 * helpers below can stay verbatim.
 */

/** Our DB stores names with a role tag ("Meena Rao (Supervisor)"); the prototype's names have none. */
export const displayName = (n: string | null | undefined): string =>
  String(n ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim();

/** Prototype shortName: "Meena Rao" -> "Meena R." */
export const shortName = (n: string | null | undefined): string => {
  const p = displayName(n).split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0];
};

/** Prototype now() format, for a stored ISO time. */
export const protoTime = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

export const todayStr = (): string =>
  new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Prototype shortTime: time of day if today, else the date without the year. */
export function shortTime(t: string): string {
  if (!t) return '';
  const m = String(t).match(/(\d{1,2}:\d{2}\s*[ap]m)/i);
  const today = todayStr();
  return m && String(t).startsWith(today) ? m[1] : String(t).split(',')[0].replace(/ 20\d\d$/, '');
}

/** Prototype: String(x.at).startsWith(todayStr()) */
export const isToday = (iso: string | null | undefined): boolean => !!iso && protoTime(iso).startsWith(todayStr());

export const lotTsMs = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Prototype waitTxt */
export function waitTxt(tsIso: string | null): string {
  const ts = lotTsMs(tsIso);
  const ms = Date.now() - ts;
  if (!ts || ms < 0) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `waiting ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `waiting ${h} h`;
  const d = Math.round(h / 24);
  return `waiting ${d} day${d > 1 ? 's' : ''}`;
}
