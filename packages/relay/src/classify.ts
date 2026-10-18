import { Category, Level } from '@priedanga/alert-format';

export interface Classification {
  category: Category;
  level: Level;
  /** True when the level comes from recognised air-alert wording. */
  airAlert: boolean;
}

/**
 * Classify a PAGD warning message from its official wording.
 *
 * This is the relay's interpretation and is labelled as such in the app; the
 * verbatim text always travels with the alert and is authoritative. Order
 * matters: "ORO PAVOJAUS NĖRA" contains "ORO PAVOJ", and "TIKĖTINAS ORO
 * PAVOJUS" contains "ORO PAVOJUS".
 */
export function classify(text: string): Classification {
  const t = text.toLocaleUpperCase('lt');
  const air = (level: Level): Classification => ({ category: Category.Air, level, airAlert: true });

  if (/ORO PAVOJAUS NĖRA|\(BALTA\)|ORO PAVOJUS ATŠAUKIAMAS|ORO PAVOJUS ATŠAUKTAS/.test(t)) return air(Level.White);
  if (/GELTONA PO RAUDONOS/.test(t)) return air(Level.YellowAfterRed);
  if (/TIKĖTINAS ORO PAVOJUS|\(GELTONA\)/.test(t)) return air(Level.Yellow);
  if (/ORO PAVOJUS|\(RAUDONA\)/.test(t)) return air(Level.Red);
  if (/CHEMIN|PAVOJINGŲ CHEMINIŲ|CHEMINĖ TARŠA/.test(t)) {
    return { category: Category.Chemical, level: Level.Yellow, airAlert: false };
  }
  if (/RADIACIN|RADIOAKTYV/.test(t)) return { category: Category.Radiation, level: Level.Yellow, airAlert: false };
  if (/POTVYN|PATVIN|VANDENS LYGIS/.test(t)) return { category: Category.Flood, level: Level.Yellow, airAlert: false };
  return { category: Category.Other, level: Level.Yellow, airAlert: false };
}

/** Validity the relay assigns, by level. The app treats expired alerts as history. */
export function lifetimeSeconds(c: Classification): number {
  if (!c.airAlert) return 24 * 3600;
  return c.level === Level.White ? 2 * 3600 : 6 * 3600;
}
