/**
 * Locale for on-screen dates and times, following the interface language.
 * Algerian Arabic (ar-DZ) keeps Western digits, matching the amounts.
 * Money keeps 'en-US' grouping on purpose; printed documents format on their own.
 */
export function uiLocale(): string {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'en';
  if (lang === 'ar') return 'ar-DZ';
  if (lang === 'fr') return 'fr-FR';
  return 'en-US';
}
