/**
 * The software in the reader's own language.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY HINGLISH AND NOT DEVANAGARI
 *
 * The people using this are supervisors, a fuel clerk and drivers in Rajasthan.
 * Most speak Hindi and read roman letters far more comfortably than they read
 * Devanagari — registration plates, phone keypads and WhatsApp are all roman.
 * "Gaadi kahan hai" is read instantly by someone who would slow down over
 * "गाड़ी कहाँ है".
 *
 * The driver capture screens keep their Devanagari, which was chosen for a
 * narrower audience doing one task with photographs. This is for everything
 * else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW WORDS ARE CHOSEN
 *
 * Simple spoken Hindi, not formal Hindi. The test is whether a supervisor would
 * say it out loud on site:
 *
 *   diesel        not डीज़ल transliterated, not "eendhan"
 *   gaadi         not "vaahan"
 *   haziri        not "upasthiti"
 *   kaam          not "kaarya"
 *
 * English words that have genuinely entered site Hindi stay in English —
 * "diesel", "driver", "site", "service", "report". Replacing them with pure
 * Hindi would be less clear, not more, which defeats the point.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MISSING KEYS FALL BACK TO ENGLISH
 *
 * There are close to a thousand strings in this app and they are being
 * translated in order of how often they are read. A key with no Hindi yet shows
 * its English, which is a screen a person can still use — a blank or a raw key
 * name is not. So a half-translated app is honest rather than broken, and the
 * remaining screens can be filled in as they matter.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const LANGUAGES = ["en", "hi"] as const;
export type Lang = (typeof LANGUAGES)[number];

export const LANGUAGE_LABEL: Record<Lang, string> = {
  en: "English",
  hi: "Hindi / Hinglish",
};

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (LANGUAGES as readonly string[]).includes(v);
}

/**
 * Hindi for keys that have one. English lives in the components already, so a
 * key absent here simply renders the English that was passed in.
 */
const HI: Record<string, string> = {
  // ── navigation ───────────────────────────────────────────────────────────
  "nav.dashboard": "Dashboard",
  "nav.dashboard.hint": "Aaj kya chal raha hai",
  "nav.fleet": "Gaadiyan",
  "nav.fleet.hint": "Gaadi kahan hai",
  "nav.tracking": "Gaadi Tracking",
  "nav.trips": "Trip",
  "nav.fuel": "Diesel",
  "nav.fuel.hint": "Kitna diesel laga",
  "nav.fuel.tanks": "Site ke Tank",
  "nav.fuel.checks": "Diesel Check",
  "nav.fuel.problems": "Diesel ki Dikkat",
  "nav.people": "Log",
  "nav.people.hint": "Kaun kaam par hai",
  "nav.people.staff": "Driver aur Staff",
  "nav.people.attendance": "Haziri",
  "nav.people.payroll": "Tankhwah",
  "nav.people.contractors": "Thekedar",
  "nav.sites": "Site aur Kaam",
  "nav.sites.hint": "Site par kya kaam chal raha hai",
  "nav.maintenance": "Repair",
  "nav.maintenance.hint": "Kiski service karni hai",
  "nav.compliance": "Kagaz aur Papers",
  "nav.compliance.hint": "Kaunse papers expire ho rahe hain",
  "nav.reports": "Report",
  "nav.reports.hint": "Business kaisa chal raha hai",
  "nav.admin": "Admin",
  "nav.admin.hint": "System settings",

  // ── everyday words, used everywhere ──────────────────────────────────────
  "common.save": "Save karein",
  "common.cancel": "Rehne dein",
  "common.add": "Jodein",
  "common.edit": "Badlein",
  "common.delete": "Hatayein",
  "common.search": "Dhoondhein",
  "common.total": "Total",
  "common.today": "Aaj",
  "common.yesterday": "Kal",
  "common.yes": "Haan",
  "common.no": "Nahi",
  "common.all": "Sab",
  "common.none": "Koi nahi",
  "common.loading": "Khul raha hai…",
  "common.notRecorded": "Likha nahi gaya",
  "common.download": "Download karein",
  "common.close": "Band karein",
  "common.back": "Wapas",
  "common.confirm": "Pakka karein",
  "common.vehicle": "Gaadi",
  "common.vehicles": "Gaadiyan",
  "common.driver": "Driver",
  "common.site": "Site",
  "common.date": "Tareekh",
  "common.amount": "Rakam",
  "common.litres": "Litre",
  "common.status": "Halat",
  "common.reason": "Wajah",
  "common.note": "Note",

  // ── vehicle status, same words as the map legend ─────────────────────────
  "status.moving": "Chal rahi hai",
  "status.idling": "Khadi hai, engine chalu",
  "status.stopped": "Ruki hui hai",
  "status.offline": "Signal nahi hai",
  "status.breakdown": "Kharab hai",

  // ── dashboard ────────────────────────────────────────────────────────────
  "dash.title": "Dashboard",
  "dash.subtitle": "Aaj kya chal raha hai",
  "dash.activeVehicles": "Chalu Gaadiyan",
  "dash.dieselToday": "Aaj ka Diesel",
  "dash.openProblems": "Khuli Dikkatein",

  // ── fuel ─────────────────────────────────────────────────────────────────
  "fuel.title": "Diesel",
  "fuel.subtitle": "Har gaadi ka diesel aur kharcha",
  "fuel.filledPerDay": "Har Din Kitna Diesel Bhara",
  "fuel.filledPerDay.sub": "Pichhle 14 din — sensor se aur haath se likhe hue, dono",
  "fuel.whichVehicles": "Kaunsi gaadiyan, aur kitna",
  "fuel.approxCost": "Andaazan Kharcha",
  "fuel.day": "Din",
  "fuel.recentFills": "Diesel Kahan Bhara",
  "fuel.theftChecks": "Diesel Chori ki Jaanch",
  "fuel.notEntered": "Jo diesel kisi ne likha nahi",
  "fuel.byVehicle": "Har Gaadi ka Diesel",
  "fuel.mileage": "Mileage",
  "fuel.bestMileage": "Sabse Achhi Mileage",
  "fuel.worstMileage": "Sabse Kharab Mileage — dekhein",
  "fuel.lastChecked": "Diesel chori ki jaanch pichhli baar hui",
  "fuel.nothingFound": "kuch nahi mila",
  "fuel.notWatching": "Abhi koi diesel chori par nazar nahi rakh raha. Support ko batayein.",

  // ── people & payroll ─────────────────────────────────────────────────────
  "people.title": "Log",
  "attendance.title": "Haziri",
  "attendance.present": "Aaya",
  "attendance.absent": "Nahi aaya",
  "attendance.halfDay": "Aadha din",
  "attendance.leave": "Chhutti",
  "attendance.rest": "Weekly off",
  "payroll.title": "Tankhwah",
  "payroll.subtitle": "Haziri se bani tankhwah — kitna paisa banta hai",
  "payroll.paySheet": "Tankhwah ki List",
  "payroll.prepare": "Is mahine ki banayein",
  "payroll.rebuild": "Haziri se dobara banayein",
  "payroll.finalise": "Final karein",
  "payroll.daysPaid": "Kitne din ka paisa",
  "payroll.advance": "Pehle diya hua paisa",
  "payroll.deduction": "Kaata gaya",
  "payroll.bonus": "Bonus",
  "payroll.net": "Dena hai",
  "payroll.wage": "Majdoori",
  "payroll.perDay": "roz ka",
  "payroll.perMonth": "mahine ka",
  "payroll.noWage": "Majdoori set nahi hai",
  "payroll.draft": "Draft — abhi final nahi hua",
  "payroll.final": "Final ho chuka hai",

  // ── tracking ─────────────────────────────────────────────────────────────
  "track.title": "Gaadi Tracking",
  "track.live": "Live",
  "track.playback": "Peechhe ka dekhein",
  "track.notUpdating": "Update nahi ho raha",
  "track.lastSeen": "pehle dekhi gayi",

  // ── compliance ───────────────────────────────────────────────────────────
  "compliance.title": "Kagaz aur Papers",
  "compliance.expiring": "Expire hone wale",
  "compliance.expired": "Expire ho chuke",
  "compliance.missing": "Hain hi nahi",

  // ── maintenance ──────────────────────────────────────────────────────────
  "maint.title": "Repair",
  "maint.dueSoon": "Jald service karni hai",
  "maint.overdue": "Service ka time nikal gaya",

  // ── the switcher itself ──────────────────────────────────────────────────
  "lang.label": "Bhasha",
  "lang.changed": "Bhasha badal gayi",
};

const DICTS: Record<Lang, Record<string, string>> = { en: {}, hi: HI };

/**
 * Builds the lookup for one language.
 *
 * `t(key, english)` takes the English alongside the key so a component reads as
 * the sentence it renders, and so a key nobody has translated yet still shows
 * something a person can act on. It also means the English is never duplicated
 * into a second file that can drift out of step with the screen.
 */
export function translator(lang: Lang): (key: string, english: string) => string {
  const dict = DICTS[lang] ?? {};
  return (key, english) => dict[key] ?? english;
}

/** How much of the app has Hindi so far — reported on the settings screen. */
export function translationCoverage(): { translated: number } {
  return { translated: Object.keys(HI).length };
}
