import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const db = new PrismaClient();
const TODAY = new Date();
const rows = JSON.parse(readFileSync(process.env.MCC_JSON || "/tmp/mcc_fleet.json", "utf8"));

function docStatus(iso) {
  const days = (new Date(iso).getTime() - TODAY.getTime()) / 86400000;
  return days < 0 ? "Expired" : days < 30 ? "Expiring" : "Valid";
}

async function main() {
  console.log("Clearing demo data…");
  await db.costTransaction.deleteMany();
  await db.alert.deleteMany();
  await db.complianceDoc.deleteMany();
  await db.fuelTransaction.deleteMany();
  await db.fuelTank.deleteMany();
  await db.trip.deleteMany();
  await db.workOrder.deleteMany();
  await db.asset.deleteMany();
  await db.driver.deleteMany();
  await db.project.deleteMany();

  // Single home base project (Nagaur, Rajasthan — RJ21 RTO)
  const base = await db.project.create({
    data: {
      code: "MCC-NAGAUR", name: "Mahadev Constructions — Nagaur Base", location: "Nagaur, Rajasthan",
      client: "Mahadev Construction Company", status: "Active", budget: 0, spent: 0, lat: 27.2020, lng: 73.7339,
    },
  });

  let assetCount = 0, docCount = 0, alertCount = 0;
  for (const r of rows) {
    const docs = [
      ["Insurance", r.insurance], ["PUC", r.puc], ["Permit", r.permit], ["Fitness", r.fitness], ["RoadTax", r.roadtax],
    ].filter(([, v]) => v);
    const expired = docs.filter(([, v]) => docStatus(v) === "Expired").length;
    const age = r.yearMfg ? TODAY.getFullYear() - r.yearMfg : 0;
    let health = 90 - expired * 12 - (age > 15 ? 18 : age > 10 ? 8 : 0);
    health = Math.max(35, Math.min(96, health));

    const asset = await db.asset.create({
      data: {
        code: `MCC-${String(r.srNo).padStart(2, "0")}`,
        registrationNo: r.registrationNo,
        name: r.name || r.rawRef || "Unnamed asset",
        assetClass: r.assetClass,
        category: r.category,
        ownershipType: "OWNED",
        make: (r.name || "").split(" ")[0] || "—",
        model: r.name || "—",
        yearMfg: r.yearMfg || 2018,
        primaryMeter: r.primaryMeter,
        meterValue: 0,
        fuelCapacity: 0,
        status: "Active",
        healthScore: health,
        utilization: 0,
        lat: 27.2020 + (Math.random() - 0.5) * 0.08,
        lng: 73.7339 + (Math.random() - 0.5) * 0.08,
        speed: 0,
        lastSeen: TODAY,
        acquisitionCost: 0,
        projectId: base.id,
      },
    });
    assetCount++;

    for (const [type, iso] of docs) {
      const status = docStatus(iso);
      await db.complianceDoc.create({
        data: {
          assetId: asset.id, docType: type, number: `${type.slice(0, 3).toUpperCase()}/${r.registrationNo || r.srNo}`,
          issueDate: r.regDate ? new Date(r.regDate) : TODAY, expiryDate: new Date(iso), status,
        },
      });
      docCount++;
      if (status !== "Valid") {
        await db.alert.create({
          data: {
            category: "Compliance", severity: status === "Expired" ? "Critical" : "Warning",
            title: `${type} ${status}`,
            message: `${type} for ${asset.code} (${r.registrationNo || r.name}) ${status === "Expired" ? "expired on" : "expires"} ${iso}`,
            assetId: asset.id, status: "Open", createdAt: TODAY,
          },
        });
        alertCount++;
      }
    }
  }

  console.log(`Imported: ${assetCount} assets, ${docCount} compliance docs, ${alertCount} alerts. Project: ${base.code}`);
  const total = await db.asset.count();
  console.log("Total assets in DB:", total);
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e.message); await db.$disconnect(); process.exit(1); });
