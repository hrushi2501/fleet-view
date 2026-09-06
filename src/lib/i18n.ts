/**
 * The software in the reader's own language.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY HINGLISH AND NOT DEVANAGARI
 *
 * The people using this are supervisors, a fuel clerk and drivers in Rajasthan.
 * Most read roman letters far more comfortably than Devanagari — number plates,
 * phone keypads and WhatsApp are all roman. "Gaadi kahan hai" is read at a
 * glance by someone who would slow down over "गाड़ी कहाँ है".
 *
 * The driver photo screens keep their Devanagari, chosen for a narrower
 * audience doing one task. This is for everything else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KEYED ON THE ENGLISH, NOT ON INVENTED KEYS
 *
 * There are eighteen hundred distinct strings already written across a hundred
 * and sixty files. Giving each an identifier like `fuel.title` would mean
 * editing every one of those call sites — a large mechanical change to screens
 * that work today, with a real chance of breaking one. Looking up the English
 * that is already on the page costs nothing at the call site and reaches all of
 * them at once.
 *
 * The trade is that identical English always gets identical Hindi. On this app
 * that is usually right: "Active", "Total" and "Vehicle" should not drift in
 * meaning between screens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW WORDS ARE CHOSEN
 *
 * Simple spoken Hindi, not formal Hindi. The test is whether a supervisor would
 * say it out loud on site: gaadi not vaahan, haziri not upasthiti, kaam not
 * kaarya. English words that have genuinely entered site Hindi stay in English
 * — diesel, driver, site, service, report, engine. Translating those would be
 * less clear, not more, which defeats the point.
 *
 * Anything with no translation yet renders its English, so an unfinished
 * dictionary is a working screen rather than a blank one.
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

const HI: Record<string, string> = {
  // ── menu ────────────────────────────────────────────────────────────────
  "Dashboard": "Dashboard",
  "Kya chal raha hai": "Aaj kya chal raha hai",
  "Fleet": "Gaadiyan",
  "Gaadi kahan hai": "Gaadi kahan hai",
  "Vehicles & Equipment": "Gaadi aur Machine",
  "Vehicle Tracking": "Gaadi Tracking",
  "Trips": "Trip",
  "Fuel": "Diesel",
  "Kitna diesel use hua": "Kitna diesel laga",
  "Site Tanks": "Site ke Tank",
  "Fuel Checks": "Diesel Check",
  "Fuel Problems": "Diesel ki Dikkat",
  "People": "Log",
  "Kaun kaam par hai": "Kaun kaam par hai",
  "Staff & Drivers": "Driver aur Staff",
  "Attendance": "Haziri",
  "Payroll": "Tankhwah",
  "Contractors": "Thekedar",
  "Sites & Work": "Site aur Kaam",
  "Site par kya kaam chal raha hai": "Site par kya kaam chal raha hai",
  "Maintenance": "Repair",
  "Kiski service karni hai": "Kiski service karni hai",
  "Compliance": "Kagaz aur Papers",
  "Kaunse documents expire ho rahe hain": "Kaunse papers expire ho rahe hain",
  "Reports": "Report",
  "Business kaisa chal raha hai": "Business kaisa chal raha hai",
  "Admin": "Admin",
  "System management": "System settings",

  // ── dashboard ───────────────────────────────────────────────────────────
  "Morning Action Center": "Subah ka Kaam",
  "Immediate operational bottlenecks requiring supervisor action today":
    "Aaj jo kaam supervisor ko turant karne hain",
  "Workshop Repairs": "Workshop ke Repair",
  "No active breakdowns": "Koi gaadi kharab nahi hai",
  "Open Job Cards": "Khule Job Card",
  "Safety & Sensor Alerts": "Safety aur Sensor ke Alert",
  "Review Alerts": "Alert dekhein",
  "Insurance & Fitness": "Insurance aur Fitness",
  "Renew Papers": "Papers renew karein",
  "Daily Attendance": "Roz ki Haziri",
  "All drivers accounted": "Sab driver ka hisaab hai",
  "1-Tap Sign-Off": "Ek tap mein sign-off",
  "Right now": "Abhi",
  "Machines free for work today, and what the rest are doing":
    "Aaj kaam ke liye khali machine, aur baaki kya kar rahi hain",
  "Ready to work": "Kaam ke liye taiyar",
  "READY TO WORK": "KAAM KE LIYE TAIYAR",
  "Open fleet": "Gaadiyan kholein",
  "Fleet status": "Gaadiyon ki halat",
  "Live distribution": "Abhi ka hisaab",
  "Distance covered": "Kitna chali",
  "Diesel burned": "Diesel jala",
  "Fleet efficiency": "Gaadiyon ka average",
  "Unaccounted diesel": "Bina hisaab ka diesel",
  "Nothing unexplained": "Sab ka hisaab hai",
  "Odometer delta": "Meter ka antar",
  "Priorities": "Zaroori kaam",
  "Shift Start": "Shift shuru",

  // ── words that appear everywhere ────────────────────────────────────────
  "Save": "Save karein",
  "Cancel": "Rehne dein",
  "Add": "Jodein",
  "Edit": "Badlein",
  "Delete": "Hatayein",
  "Search": "Dhoondhein",
  "Total": "Total",
  "Today": "Aaj",
  "Yesterday": "Kal",
  "Active": "Chalu",
  "Inactive": "Band",
  "Status": "Halat",
  "Reason": "Wajah",
  "Notes": "Note",
  "Note": "Note",
  "Date": "Tareekh",
  "Amount": "Rakam",
  "Litres": "Litre",
  "Vehicle": "Gaadi",
  "Vehicles": "Gaadiyan",
  "Machine": "Machine",
  "Driver": "Driver",
  "Drivers": "Driver",
  "Site": "Site",
  "Sites": "Site",
  "Project": "Site",
  "Projects": "Site",
  "Open": "Khula",
  "Closed": "Band",
  "Pending": "Baaki hai",
  "Approved": "Manzoor",
  "Rejected": "Mana kiya",
  "Verified": "Check ho gaya",
  "Review": "Dekhein",
  "Details": "Poori jankari",
  "Download": "Download karein",
  "Export": "Nikalein",
  "Close": "Band karein",
  "Back": "Wapas",
  "Confirm": "Pakka karein",
  "Yes": "Haan",
  "No": "Nahi",
  "All": "Sab",
  "None": "Koi nahi",
  "Loading": "Khul raha hai",
  "Not recorded": "Likha nahi gaya",
  "Not set": "Set nahi hai",
  "Action required": "Kuch karna hai",
  "Acknowledge": "Dekh liya",
  "Quick Action": "Turant Kaam",
  "Live": "Live",

  // ── vehicle status ──────────────────────────────────────────────────────
  "Moving": "Chal rahi hai",
  "Idling": "Khadi, engine chalu",
  "Stopped": "Ruki hui",
  "Offline": "Signal nahi",
  "Breakdown": "Kharab",
  "On Trip": "Trip par",

  // ── fuel ────────────────────────────────────────────────────────────────
  "Fuel Use & Mileage": "Diesel aur Mileage",
  "Mileage and cost per km for each vehicle, and fills that look wrong":
    "Har gaadi ki mileage aur per km kharcha, aur jo bharai galat lag rahi hai",
  "Diesel Filled Each Day — All Vehicles": "Har Din Kitna Diesel Bhara — Sab Gaadiyan",
  "Last 14 days — from the fuel sensor and from fills entered by hand":
    "Pichhle 14 din — sensor se aur haath se likhe hue, dono",
  "Which vehicles, and how much": "Kaunsi gaadiyan, aur kitna",
  "Approx. Cost": "Andaazan Kharcha",
  "Day": "Din",
  "Where Fuel Was Filled": "Diesel Kahan Bhara",
  "Fuel Theft Checks": "Diesel Chori ki Jaanch",
  "Fuel Use by Vehicle": "Har Gaadi ka Diesel",
  "Mileage and cost for every machine with fuel records":
    "Har machine ki mileage aur kharcha jiska diesel record hai",
  "Best Mileage": "Sabse Achhi Mileage",
  "Worst Mileage — check these": "Sabse Kharab Mileage — inhein dekhein",
  "Total Diesel Spend": "Total Diesel Kharcha",
  "Total Diesel Issued": "Total Diesel Diya",
  "Recent Fuel Spend": "Haal ka Diesel Kharcha",
  "Active Fleet Vehicles": "Chalu Gaadiyan",
  "Site Diesel Tanks": "Site ke Diesel Tank",
  "Fill History": "Bharai ka Record",
  "How the days are counted": "Din kaise gine jaate hain",
  "So anyone can check the sheet by hand": "Taki koi bhi haath se hisaab check kar sake",

  // ── people, attendance, payroll ─────────────────────────────────────────
  "Present": "Aaya",
  "Absent": "Nahi aaya",
  "Half Day": "Aadha din",
  "Leave": "Chhutti",
  "Rest": "Weekly off",
  "Wages worked out from the attendance register — kitna paisa banta hai":
    "Haziri se bani tankhwah — kitna paisa banta hai",
  "Monthly Pay Sheet": "Mahine ki Tankhwah",
  "Wages": "Majdoori",
  "This Month's Pay": "Is Mahine ki Tankhwah",
  "Advances Taken": "Pehle Diya Hua Paisa",
  "Already given out": "Pehle de diya gaya",
  "Person": "Aadmi",
  "Wage": "Majdoori",
  "Days Paid": "Kitne din ka paisa",
  "Advance": "Advance",
  "Net": "Dena hai",
  "Bonus": "Bonus",
  "Adjust": "Theek karein",
  "Finalise": "Final karein",
  "Prepare this month": "Is mahine ki banayein",
  "Rebuild from attendance": "Haziri se dobara banayein",
  "Set wage": "Majdoori set karein",
  "New wage": "Nayi majdoori",
  "No wage set": "Majdoori set nahi hai",
  "Works as": "Kaam karta hai",
  "Current wage": "Abhi ki majdoori",
  "Overtime": "Overtime",
  "Since": "Kab se",
  "Earlier wages": "Purani majdoori",
  "Per day": "Roz ka",
  "Per month": "Mahine ka",

  // ── tracking ────────────────────────────────────────────────────────────
  "Play Back": "Peechhe ka dekhein",
  "Not updating": "Update nahi ho raha",
  "Cabin QR Stickers": "Cabin ke QR Sticker",
  "Live Map": "Live Map",

  // ── compliance & maintenance ────────────────────────────────────────────
  "Expiring Soon": "Jald expire honge",
  "Expired": "Expire ho gaye",
  "Missing": "Hai hi nahi",
  "Valid": "Theek hai",
  "Documents": "Papers",
  "Work Orders": "Kaam ke Order",
  "Due Soon": "Jald karna hai",
  "Overdue": "Time nikal gaya",
  "Job Cards": "Job Card",
  "Breakdowns": "Kharab Gaadiyan",

  "Fuel Use &amp; Mileage": "Diesel aur Mileage",
  "Critical alerts": "Zaroori alert",
  "Documents expiring": "Papers expire ho rahe",
  "Fleet value": "Gaadiyon ki keemat",
  "Fuel loss (30d)": "Diesel nuksan (30 din)",
  "Acquisition cost": "Kharidne ka daam",
  "Insurance · permit · fitness": "Insurance · permit · fitness",
  "Average across each class": "Har type ka average",
  "Litres per day across all sites": "Sab site par roz kitne litre",
  "Lowest health scores first": "Sabse kharab halat pehle",
  "Running cost by type, and diesel going into tanks": "Type ke hisaab se kharcha, aur tank mein jaata diesel",
  "The five biggest costs · the rest are grouped together": "Paanch sabse bade kharche · baaki ek saath",
  "Diesel issued — last 14 days": "Diesel diya — pichhle 14 din",
  "Machines that can take work today, and what the rest are doing": "Aaj kaam le sakne wali machine, aur baaki kya kar rahi hain",
  "Fleet Overview": "Gaadiyon ka Hisaab",
  "Add Vehicle": "Gaadi jodein",
  "Add Driver": "Driver jodein",
  "Record Fuel": "Diesel likhein",
  "Mark Attendance": "Haziri lagayein",
  "This month": "Is mahine",
  "Last month": "Pichhle mahine",
  "Last 7 days": "Pichhle 7 din",
  "Last 30 days": "Pichhle 30 din",
  "Per Vehicle": "Har gaadi",
  "No data yet": "Abhi koi data nahi",
  "Nothing to show": "Dikhane ko kuch nahi",
  "Something went wrong": "Kuch gadbad ho gayi",
  "Try again": "Dobara koshish karein",

  // ── the switcher ────────────────────────────────────────────────────────
  "Language": "Bhasha",
};

const DICTS: Record<Lang, Record<string, string>> = { en: {}, hi: HI };

/**
 * Builds the lookup for one language.
 *
 * Called as `t(english, english)` from `Tr`, and as `t(key, english)` from the
 * navigation, which still uses explicit keys because its labels are short words
 * that would otherwise collide with the same words used elsewhere — "Fleet" as
 * a menu item and "Fleet" in a sentence want different Hindi.
 */
export function translator(lang: Lang): (key: string, english: string) => string {
  const dict = DICTS[lang] ?? {};
  return (key, english) => dict[key] ?? dict[english] ?? english;
}

/** How much of the app has Hindi so far. */
export function translationCoverage(): { translated: number } {
  return { translated: Object.keys(HI).length };
}
