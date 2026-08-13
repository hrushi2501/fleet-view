/**
 * Imports Mahadev Constructions' vehicle register from the compliance sheet.
 *
 * WHY THIS EXISTS ALONGSIDE import-mcc.mjs
 *
 * `import-mcc.mjs` opens by deleting every asset, driver, project, work order
 * and compliance document. That was written to replace demo data on an empty
 * system. Running it now would cascade-delete TRU-053 and, with it, the ~530
 * telemetry readings pulled from Fleet Edge since 10 August — data that cannot
 * be re-fetched, because the provider's endpoint only ever returns the vehicle's
 * *current* state. So this is a separate, additive importer.
 *
 * WHAT IT DOES
 *
 *   - Matches on registration number with punctuation and case ignored, so the
 *     sheet's "RJ21 GE 3220" resolves to the tracked asset already stored as
 *     "RJ21GE3220" instead of creating a duplicate of the same truck.
 *   - Never overwrites a field the vehicle itself reports. Odometer, fuel level
 *     and last-seen come from telemetry and are always better than a spreadsheet.
 *   - Records Insurance, PUC, Permit and Fitness as compliance documents with
 *     their real expiry dates, which is what makes the compliance module and its
 *     expiry alerts start working.
 *
 * Nothing is written without --apply.
 *
 *   node --env-file=.env.local prisma/import-fleet-sheet.mjs            # dry run
 *   node --env-file=.env.local prisma/import-fleet-sheet.mjs --apply
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const db = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const SRC = process.env.FLEET_JSON || "/tmp/fleet_rows.json";

/** Punctuation and case carry no meaning in a registration number. */
const normReg = (v) => String(v ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

/**
 * Model text to asset class.
 *
 * Ordered: the first pattern that matches wins, so specific names are listed
 * before the generic words they contain. Anything unmatched is reported rather
 * than guessed — a wrong class silently applies the wrong fuel norm, and the
 * mileage of a bike judged as a tipper is nonsense nobody would question.
 */
const CLASS_RULES = [
  [/crusher/i,                         "CRUSHER"],
  [/asphalt|batch|bathing|wmm|plant/i, "PLANT"],
  [/hitachi|ex\s*200|j215/i,           "EXCAVATOR"],
  [/3dx|backhoe/i,                     "BACKHOE"],
  [/grader/i,                          "GRADER"],
  [/vmt|vm\s*116|emveqp/i,             "ROLLER"],
  [/tractor/i,                         "TRACTOR"],
  [/tank[ae]*r/i,                      "WATER_TANKER"],
  [/mixer|transit/i,                   "TRANSIT_MIXER"],
  [/crane/i,                           "CRANE"],
  [/scooter|bike|hf\s*deluxe|honda/i,  "BIKE"],
  [/fortuner|scorpio|endeavour|\bkia\b|bolero/i, "CAR"],
  [/pik\s*up|pickup/i,                 "PICKUP"],
  [/mahindra/i,                        "PICKUP"],
  [/signa|bharatbenz|912|2830|3530|3525|3528|4830|tk\b|hgv|lpk|tata/i, "TRUCK"],
];
const classify = (model) => CLASS_RULES.find(([re]) => re.test(model))?.[1] ?? null;

const makeOf = (m) =>
  (/tata|signa/i.test(m) && "Tata") || (/bharatbenz/i.test(m) && "BharatBenz") ||
  (/jcb/i.test(m) && "JCB") || (/mahindra|scorpio|bolero/i.test(m) && "Mahindra") ||
  (/toyota|fortuner/i.test(m) && "Toyota") || (/ford|endeavour/i.test(m) && "Ford") ||
  (/kia/i.test(m) && "Kia") || (/honda/i.test(m) && "Honda") || (/hero|hf/i.test(m) && "Hero") ||
  (/l\s*&?\s*t|lnt/i.test(m) && "L&T") || "Unknown";

const asDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v).trim();
  // The sheet mixes ISO timestamps with hand-typed DD-MM-YYYY.
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12));
  const d = new Date(s);
  return isNaN(d) ? null : d;
};

const docStatus = (d, now = new Date()) => {
  const days = (d.getTime() - now.getTime()) / 86400000;
  return days < 0 ? "Expired" : days < 30 ? "Expiring" : "Valid";
};

async function main() {
  const rows = JSON.parse(readFileSync(SRC, "utf8"));
  const existing = await db.asset.findMany({
    select: { id: true, code: true, registrationNo: true, assetClass: true },
  });
  const byReg = new Map(existing.map((a) => [normReg(a.registrationNo), a]));
  const usedCodes = new Set(existing.map((a) => a.code));

  let created = 0, matched = 0, docs = 0, skipped = 0;
  const unclassified = [], report = [];

  for (const r of rows) {
    const rawReg = String(r.registration ?? "").trim();
    const model = String(r.model ?? "").trim();
    const reg = normReg(rawReg);

    // Plants, crushers and the "NON REG" line have no registration to key on.
    // They are real assets, so they are imported under a generated code.
    const isUnregistered = !reg || /^(NONREG|LNT|PLANT|CRUSHER)$/i.test(reg);
    const cls = classify(model);
    if (!cls) { unclassified.push(`${rawReg || "(no reg)"} — ${model}`); skipped++; continue; }

    const hit = !isUnregistered ? byReg.get(reg) : null;
    if (hit) {
      matched++;
      report.push(`  MATCH  ${rawReg.padEnd(16)} -> ${hit.code} (${hit.assetClass}) — kept, docs added`);
    } else {
      created++;
      report.push(`  NEW    ${rawReg.padEnd(16)} ${cls.padEnd(13)} ${model}`);
    }

    if (!APPLY) { docs += ["Insurance", "PUC", "Permit", "Fitness"].filter((k) => asDate(r[k.toLowerCase()])).length; continue; }

    let assetId = hit?.id;
    if (!assetId) {
      // A stable, readable code: class prefix + last four of the registration.
      const base = `${cls.slice(0, 3)}-${reg.slice(-4) || String(created).padStart(3, "0")}`;
      let code = base, n = 1;
      while (usedCodes.has(code)) code = `${base}-${++n}`;
      usedCodes.add(code);
      const a = await db.asset.create({
        data: {
          code, name: model || code, assetClass: cls, category: /PLANT|CRUSHER/.test(cls) ? "EQUIPMENT" : "VEHICLE",
          ownershipType: "OWNED", make: makeOf(model), model: model || "Unknown",
          yearMfg: asDate(r.registered)?.getUTCFullYear() ?? 0,
          primaryMeter: /EXCAVATOR|BACKHOE|GRADER|ROLLER|CRANE|PLANT|CRUSHER/.test(cls) ? "SMU" : "ODOMETER",
          registrationNo: isUnregistered ? null : rawReg.replace(/\s+/g, ""),
          status: "Active",
        },
      });
      assetId = a.id;
    }

    for (const [label, key] of [["Insurance","insurance"],["PUC","puc"],["Permit","permit"],["Fitness","fitness"]]) {
      const exp = asDate(r[key]);
      if (!exp) continue;
      const found = await db.complianceDoc.findFirst({ where: { assetId, docType: label }, select: { id: true } });
      const data = { expiryDate: exp, status: docStatus(exp) };
      if (found) await db.complianceDoc.update({ where: { id: found.id }, data });
      else { await db.complianceDoc.create({ data: { assetId, docType: label, number: "", issueDate: exp, ...data } }); docs++; }
    }
  }

  console.log(report.join("\n"));
  if (unclassified.length) {
    console.log(`\nNot imported — model not recognised (${unclassified.length}):`);
    for (const u of unclassified) console.log("   ", u);
  }
  console.log(`\n${APPLY ? "IMPORTED" : "DRY RUN"}: ${created} new, ${matched} matched existing, ${docs} compliance documents, ${skipped} skipped.`);
  if (!APPLY) console.log("Re-run with --apply to write.\n");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
