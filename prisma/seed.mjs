import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const db = new PrismaClient();

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[rand(0, arr.length - 1)];
const daysFromNow = (d) => new Date(Date.now() + d * 86400000);
const hoursAgo = (h) => new Date(Date.now() - h * 3600000);

async function main() {
  // This script DESTROYS the database before repopulating it with generated
  // demo records. It ran against the client's live system once already; the
  // real fleet and its Fleet Edge telemetry would not survive a second time.
  // `npm run setup` and `npm run db:deploy` both call it, so the flag is the
  // only thing standing between a routine-looking command and data loss.
  if (process.env.ALLOW_DEMO_SEED !== "true") {
    console.error(
      "\nRefusing to seed: this wipes every table and inserts fake data.\n" +
        "It is not safe to run against a live database.\n\n" +
        "If you genuinely want demo data in THIS database, re-run with:\n" +
        "  ALLOW_DEMO_SEED=true npm run seed\n",
    );
    process.exit(1);
  }

  // Demo data is often copied into a long-lived environment. Do not write
  // published credentials (or plaintext passwords) even in this destructive
  // development-only seed path.
  const demoAdminPassword = process.env.DEMO_ADMIN_PASSWORD ?? "";
  const demoSecondaryAdminPassword = process.env.DEMO_SECONDARY_ADMIN_PASSWORD ?? "";
  const isStrongPassword = (value) =>
    value.length >= 12 && /[A-Za-z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
  if (!isStrongPassword(demoAdminPassword) || !isStrongPassword(demoSecondaryAdminPassword)) {
    console.error(
      "\nRefusing to seed: set distinct DEMO_ADMIN_PASSWORD and DEMO_SECONDARY_ADMIN_PASSWORD values.\n" +
        "Each must be at least 12 characters with a letter, number, and symbol; never use a published password.\n",
    );
    process.exit(1);
  }
  if (demoAdminPassword === demoSecondaryAdminPassword) {
    console.error("\nRefusing to seed: demo administrator accounts must not share a password.\n");
    process.exit(1);
  }
  const adminPasswordHash = await bcrypt.hash(demoAdminPassword, 10);
  const secondaryAdminPasswordHash = await bcrypt.hash(demoSecondaryAdminPassword, 10);

  console.log("Clearing existing database tables...");
  await db.inventoryTransaction.deleteMany();
  await db.inventoryStock.deleteMany();
  await db.inventoryItem.deleteMany();
  await db.inventoryWarehouse.deleteMany();
  await db.tyreEvent.deleteMany();
  await db.tyre.deleteMany();
  await db.majorComponent.deleteMany();
  await db.costTransaction.deleteMany();
  await db.alert.deleteMany();
  await db.complianceDoc.deleteMany();
  await db.workOrder.deleteMany();
  await db.fuelTransaction.deleteMany();
  await db.fuelTank.deleteMany();
  await db.trip.deleteMany();
  await db.asset.deleteMany();
  await db.driver.deleteMany();
  await db.project.deleteMany();
  await db.user.deleteMany();

  console.log("Creating Admin Users...");
  await db.user.create({
    data: { email: "admin@mahadev.com", name: "Rohit Jangid", role: "Admin", password: adminPasswordHash },
  });
  await db.user.create({
    data: { email: "administrator@madevcons.com", name: "Administrator", role: "Admin", password: secondaryAdminPasswordHash },
  });

  console.log("Creating Projects...");
  const projectSeed = [
    { code: "NH48-PUN", name: "NH-48 Pune–Satara 6-Laning", location: "Pune, Maharashtra", client: "NHAI", budget: 8400000000, spent: 5230000000, lat: 18.52, lng: 73.85 },
    { code: "EXP-DME", name: "Delhi–Mumbai Expressway Pkg-12", location: "Vadodara, Gujarat", client: "NHAI", budget: 12600000000, spent: 4100000000, lat: 22.31, lng: 73.18 },
    { code: "RRR-HYD", name: "Hyderabad Regional Ring Road", location: "Hyderabad, Telangana", client: "HMDA", budget: 5600000000, spent: 3890000000, lat: 17.38, lng: 78.48 },
    { code: "BLR-MET", name: "Bengaluru Metro Phase-3 Civil", location: "Bengaluru, Karnataka", client: "BMRCL", budget: 4200000000, spent: 1560000000, lat: 12.97, lng: 77.59 },
    { code: "JPR-BYP", name: "Jaipur Ring Road Bypass", location: "Jaipur, Rajasthan", client: "RSRDC", budget: 3100000000, spent: 2740000000, lat: 26.91, lng: 75.78 },
  ];
  const projects = [];
  for (const p of projectSeed) projects.push(await db.project.create({ data: p }));

  console.log("Creating Drivers/Operators...");
  const firstNames = ["Ramesh", "Suresh", "Mahesh", "Vijay", "Deepak", "Arjun", "Sanjay", "Manoj", "Prakash", "Rakesh", "Dinesh", "Mukesh", "Naresh", "Vikram", "Sunil", "Anil", "Ravi", "Ashok", "Gopal", "Hari", "Kiran", "Lalit", "Mohan", "Nitin", "Pankaj"];
  const lastNames = ["Yadav", "Singh", "Patil", "Kumar", "Reddy", "Verma", "Sharma", "Gupta", "Jadhav", "Naik", "Rao", "Chauhan", "Pawar", "Mishra"];
  const drivers = [];
  for (let i = 0; i < 30; i++) {
    const isOp = i % 3 === 0;
    drivers.push(
      await db.driver.create({
        data: {
          empCode: `EMP-${1000 + i}`,
          name: `${pick(firstNames)} ${pick(lastNames)}`,
          phone: `9${rand(100000000, 999999999)}`,
          type: isOp ? "OPERATOR" : "DRIVER",
          licenseNo: `MH${rand(10, 49)} ${rand(2015, 2022)}${rand(1000000, 9999999)}`,
          licenseExpiry: daysFromNow(rand(-20, 400)),
          certifications: isOp ? pick(["Excavator L3", "Crane Operator", "Grader Certified", "Roller Certified"]) : "HMV",
          safetyScore: rand(58, 98),
          performanceScore: rand(60, 97),
          attendance: rand(78, 100),
          status: "Active",
        },
      })
    );
  }

  console.log("Creating Assets...");
  const classes = [
    { c: "DUMPER", cat: "VEHICLE", meter: "ODOMETER", makes: [["Tata", "Signa 2823.K"], ["Ashok Leyland", "U-3518"]], cap: 300 },
    { c: "TIPPER", cat: "VEHICLE", meter: "ODOMETER", makes: [["BharatBenz", "2823C"], ["Tata", "Prima 2830.K"]], cap: 290 },
    { c: "EXCAVATOR", cat: "EQUIPMENT", meter: "SMU", makes: [["Caterpillar", "320D2"], ["JCB", "JS220"], ["Komatsu", "PC210"]], cap: 400 },
    { c: "BACKHOE", cat: "EQUIPMENT", meter: "SMU", makes: [["JCB", "3DX"], ["CASE", "770"]], cap: 130 },
    { c: "GRADER", cat: "EQUIPMENT", meter: "SMU", makes: [["Caterpillar", "120K"], ["LeeBoy", "G7820"]], cap: 320 },
    { c: "ROLLER", cat: "EQUIPMENT", meter: "SMU", makes: [["JCB", "VMT330"], ["Caterpillar", "CS11"]], cap: 240 },
    { c: "CRANE", cat: "EQUIPMENT", meter: "SMU", makes: [["ACE", "NX140"], ["Escorts", "F15"]], cap: 280 },
    { c: "TRANSIT_MIXER", cat: "VEHICLE", meter: "ODOMETER", makes: [["Tata", "LPK 2518"], ["Ashok Leyland", "2518"]], cap: 250 },
    { c: "WATER_TANKER", cat: "VEHICLE", meter: "ODOMETER", makes: [["Tata", "LPT 1613"], ["Ashok Leyland", "1616"]], cap: 200 },
    { c: "TRUCK", cat: "VEHICLE", meter: "ODOMETER", makes: [["Tata", "LPT 3118"], ["BharatBenz", "3528C"]], cap: 365 },
    { c: "PICKUP", cat: "VEHICLE", meter: "ODOMETER", makes: [["Mahindra", "Bolero Pik-Up"], ["Tata", "Yodha"]], cap: 60 },
  ];
  const owns = ["OWNED", "OWNED", "OWNED", "LEASED", "HIRED", "CONTRACTOR"];
  const statuses = ["Active", "Active", "Active", "Idle", "Under-Maintenance", "In-Transit", "Breakdown"];
  const assets = [];
  let assetNum = 1;
  for (const cls of classes) {
    const count = cls.cat === "EQUIPMENT" ? rand(4, 6) : rand(3, 5);
    for (let i = 0; i < count; i++) {
      const proj = pick(projects);
      const make = pick(cls.makes);
      const status = pick(statuses);
      const meterVal = cls.meter === "SMU" ? rand(800, 14000) : rand(20000, 280000);
      const a = await db.asset.create({
        data: {
          code: `${cls.c.slice(0, 3)}-${String(assetNum).padStart(3, "0")}`,
          registrationNo: cls.cat === "VEHICLE" ? `${pick(["MH", "GJ", "TS", "KA", "RJ"])}${rand(10, 49)} ${pick(["AB", "CD", "EF", "GH"])} ${rand(1000, 9999)}` : null,
          name: `${make[0]} ${make[1]}`,
          assetClass: cls.c,
          category: cls.cat,
          ownershipType: pick(owns),
          make: make[0],
          model: make[1],
          yearMfg: rand(2016, 2024),
          primaryMeter: cls.meter,
          meterValue: meterVal,
          fuelCapacity: cls.cap,
          status,
          healthScore: status === "Breakdown" ? rand(25, 45) : status === "Under-Maintenance" ? rand(40, 65) : rand(62, 98),
          utilization: status === "Idle" ? rand(5, 25) : rand(45, 92),
          lat: proj.lat + (Math.random() - 0.5) * 0.15,
          lng: proj.lng + (Math.random() - 0.5) * 0.15,
          speed: status === "Active" && cls.cat === "VEHICLE" ? rand(0, 65) : 0,
          lastSeen: hoursAgo(rand(0, status === "Breakdown" ? 30 : 3)),
          acquisitionCost: cls.cat === "EQUIPMENT" ? rand(4000000, 28000000) : rand(2500000, 9000000),
          projectId: proj.id,
          driverId: pick(drivers).id,
        },
      });
      assets.push(a);
      assetNum++;
    }
  }

  console.log("Creating Fuel Tanks...");
  for (const p of projects) {
    await db.fuelTank.create({ data: { name: `Site Diesel Tank — ${p.code}`, location: p.location, capacity: 20000, currentLevel: rand(3000, 18000) } });
  }

  console.log("Bulk creating Fuel Transactions...");
  const fuelTxns = [];
  for (let d = 0; d < 30; d++) {
    const dailyIssues = rand(8, 16);
    for (let i = 0; i < dailyIssues; i++) {
      const a = pick(assets);
      const qty = rand(40, 220);
      const anomaly = Math.random() < 0.08;
      const sensorRise = anomaly ? qty * (0.55 + Math.random() * 0.2) : qty * (0.95 + Math.random() * 0.08);
      const variancePct = ((qty - sensorRise) / qty) * 100;
      fuelTxns.push({
        type: "ISSUE",
        assetId: a.id,
        projectId: a.projectId,
        quantity: qty,
        rate: 92.5,
        amount: qty * 92.5,
        meterValue: a.meterValue,
        sensorRise: Math.round(sensorRise),
        variancePct: Math.round(variancePct * 10) / 10,
        anomaly,
        geofenceOk: !anomaly || Math.random() > 0.5,
        date: hoursAgo(d * 24 + rand(0, 23)),
      });
    }
    if (d % 3 === 0) {
      const p = pick(projects);
      const q = rand(5000, 12000);
      fuelTxns.push({ type: "RECEIPT", projectId: p.id, quantity: q, rate: 91.8, amount: q * 91.8, date: hoursAgo(d * 24) });
    }
  }
  await db.fuelTransaction.createMany({ data: fuelTxns });

  console.log("Bulk creating Trips...");
  const trips = [];
  for (let d = 0; d < 14; d++) {
    for (let i = 0; i < rand(15, 30); i++) {
      const a = pick(assets);
      const isVeh = a.category === "VEHICLE";
      const eng = rand(4, 11);
      trips.push({
        assetId: a.id,
        driverId: a.driverId,
        projectId: a.projectId,
        startTime: hoursAgo(d * 24 + rand(4, 12)),
        endTime: hoursAgo(d * 24 + rand(0, 3)),
        distanceKm: isVeh ? rand(40, 320) : 0,
        engineHours: eng,
        idleHours: Math.round(eng * (0.1 + Math.random() * 0.3) * 10) / 10,
        tonnage: isVeh && (a.assetClass === "DUMPER" || a.assetClass === "TIPPER") ? rand(80, 260) : 0,
        gpsVerified: Math.random() > 0.05,
        status: "Completed",
      });
    }
  }
  await db.trip.createMany({ data: trips });

  console.log("Bulk creating Work Orders...");
  const woTypes = ["PM", "BREAKDOWN", "REPAIR"];
  const woDesc = ["250-hr service — oil & filters", "Hydraulic hose replacement", "Brake system overhaul", "Engine overheating diagnosis", "Track/undercarriage inspection", "Transmission repair", "AC & electrical fix", "Tyre replacement (set)", "Coolant leak repair", "Alternator replacement"];
  const workOrders = [];
  for (let i = 0; i < 45; i++) {
    const a = pick(assets);
    const type = pick(woTypes);
    const status = pick(["Open", "In-Progress", "Completed", "Completed", "Closed"]);
    const parts = rand(2000, 180000);
    const labor = rand(1500, 40000);
    const done = status === "Completed" || status === "Closed";
    workOrders.push({
      woNo: `WO-${2026}${String(1000 + i)}`,
      assetId: a.id,
      projectId: a.projectId,
      type,
      priority: type === "BREAKDOWN" ? pick(["High", "Critical"]) : pick(["Low", "Medium", "High"]),
      status,
      description: pick(woDesc),
      laborCost: labor,
      partsCost: parts,
      totalCost: parts + labor,
      downtimeHrs: done ? rand(2, 72) : rand(1, 20),
      warranty: Math.random() < 0.15,
      reportedAt: hoursAgo(rand(2, 600)),
      completedAt: done ? hoursAgo(rand(1, 100)) : null,
    });
  }
  await db.workOrder.createMany({ data: workOrders });

  console.log("Bulk creating Compliance Docs...");
  const docTypes = ["RC", "Insurance", "Fitness", "Permit", "PUC", "RoadTax"];
  const complianceDocs = [];
  for (const a of assets) {
    for (const dt of docTypes) {
      if (a.category === "EQUIPMENT" && (dt === "Permit" || dt === "RoadTax")) continue;
      const exp = daysFromNow(rand(-25, 365));
      const days = (exp - Date.now()) / 86400000;
      complianceDocs.push({
        assetId: a.id,
        docType: dt,
        number: `${dt.slice(0, 3).toUpperCase()}-${rand(100000, 999999)}`,
        issueDate: daysFromNow(-rand(200, 600)),
        expiryDate: exp,
        status: days < 0 ? "Expired" : days < 30 ? "Expiring" : "Valid",
      });
    }
  }
  await db.complianceDoc.createMany({ data: complianceDocs });

  console.log("Creating Alerts...");
  const alertsToCreate = [];
  // fetch anomalous fuel txns from created list
  const anomFuel = await db.fuelTransaction.findMany({ where: { anomaly: true }, include: { asset: true }, take: 12 });
  for (const f of anomFuel) {
    alertsToCreate.push({ category: "Fuel", severity: "Critical", title: "Fuel diversion suspected", message: `Issued ${f.quantity}L but sensor rise only ${f.sensorRise}L (${f.variancePct}% variance) on ${f.asset?.code}`, assetId: f.assetId, status: "Open", createdAt: f.date });
  }
  const expiring = await db.complianceDoc.findMany({ where: { status: { in: ["Expiring", "Expired"] } }, include: { asset: true }, take: 15 });
  for (const c of expiring) {
    alertsToCreate.push({ category: "Compliance", severity: c.status === "Expired" ? "Critical" : "Warning", title: `${c.docType} ${c.status}`, message: `${c.docType} ${c.number} for ${c.asset?.code} expires ${c.expiryDate.toISOString().slice(0, 10)}`, assetId: c.assetId, status: "Open" });
  }
  const broken = assets.filter((a) => a.status === "Breakdown").slice(0, 6);
  for (const a of broken) {
    alertsToCreate.push({ category: "Maintenance", severity: "Critical", title: "Asset breakdown", message: `${a.code} (${a.name}) reported breakdown — health score ${a.healthScore}`, assetId: a.id, status: "Open" });
  }
  for (const a of assets.filter((a) => a.utilization < 25).slice(0, 8)) {
    alertsToCreate.push({ category: "Idle", severity: "Warning", title: "Under-utilized asset", message: `${a.code} utilization at ${a.utilization}% — consider redeployment`, assetId: a.id, status: "Open" });
  }
  for (const drv of drivers.filter((d) => d.safetyScore < 65).slice(0, 6)) {
    alertsToCreate.push({ category: "Driver", severity: "Warning", title: "Low driver safety score", message: `${drv.name} (${drv.empCode}) safety score ${drv.safetyScore} — coaching recommended`, driverId: drv.id, status: "Open" });
  }
  await db.alert.createMany({ data: alertsToCreate });

  console.log("Bulk creating Cost Transactions...");
  const heads = ["FUEL", "MAINTENANCE", "TYRE", "OPERATOR", "INSURANCE", "DEPRECIATION", "EMI", "TOLL", "HIRE"];
  const now = new Date();
  const costTxns = [];
  for (let m = 5; m >= 0; m--) {
    const dt = new Date(now.getFullYear(), now.getMonth() - m, 15);
    const period = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    for (const a of assets) {
      for (const head of heads) {
        let base = 0;
        if (head === "FUEL") base = rand(80000, 400000);
        else if (head === "MAINTENANCE") base = rand(10000, 120000);
        else if (head === "OPERATOR") base = rand(25000, 45000);
        else if (head === "DEPRECIATION") base = Math.round(a.acquisitionCost / 84);
        else if (head === "EMI") base = a.ownershipType === "LEASED" ? rand(60000, 180000) : 0;
        else if (head === "HIRE") base = a.ownershipType === "HIRED" || a.ownershipType === "CONTRACTOR" ? rand(120000, 350000) : 0;
        else base = rand(3000, 30000);
        if (base > 0) {
          costTxns.push({ assetId: a.id, projectId: a.projectId, costHead: head, amount: base, period, date: dt });
        }
      }
    }
  }
  await db.costTransaction.createMany({ data: costTxns });

  console.log("Seeding Warehouses and Inventory SKUs...");
  const warehouses = [];
  const whData = [
    { code: "PUN-CENT", name: "Pune Central Yard Store", location: "Pune, Maharashtra", projectId: projects[0].id },
    { code: "VAD-SITE", name: "Vadodara Highway Store", location: "Vadodara, Gujarat", projectId: projects[1].id },
    { code: "HYD-RING", name: "Hyderabad Regional Ring Store", location: "Hyderabad, Telangana", projectId: projects[2].id },
  ];
  for (const wh of whData) {
    warehouses.push(await db.inventoryWarehouse.create({ data: wh }));
  }

  const items = [];
  const itemData = [
    { partNo: "OIL-15W40-20L", name: "Engine Oil 15W-40 (20L)", description: "Premium engine oil for heavy diesel engines", category: "LUBRICANT", unitOfMeasure: "BOX", minStockLevel: 10, averageCost: 5500 },
    { partNo: "FIL-CAT320-O", name: "CAT 320D Oil Filter", description: "Spin-on engine oil filter for CAT 320", category: "PART", unitOfMeasure: "PCS", minStockLevel: 15, averageCost: 1200 },
    { partNo: "FIL-JCB3DX-A", name: "JCB 3DX Air Filter Element", description: "Primary air filter element for JCB backhoe", category: "PART", unitOfMeasure: "PCS", minStockLevel: 5, averageCost: 2200 },
    { partNo: "HOSE-HYD-12", name: "Hydraulic Hose 1/2\" R2", description: "High pressure flexible hydraulic line", category: "PART", unitOfMeasure: "PCS", minStockLevel: 20, averageCost: 850 },
    { partNo: "LGT-LED-24V", name: "LED Cabin Light 24V", description: "Heavy-duty waterproof cabin work light", category: "CONSUMABLE", unitOfMeasure: "PCS", minStockLevel: 8, averageCost: 950 },
  ];
  for (const item of itemData) {
    items.push(await db.inventoryItem.create({ data: item }));
  }

  // Create stock levels and receipts
  const stocksToCreate = [];
  const transactionsToCreate = [];
  for (const wh of warehouses) {
    for (const item of items) {
      const qty = rand(4, 35);
      stocksToCreate.push({ itemId: item.id, warehouseId: wh.id, quantity: qty });
      transactionsToCreate.push({
        type: "RECEIPT",
        itemId: item.id,
        warehouseId: wh.id,
        quantity: qty,
        unitCost: item.averageCost,
        totalCost: qty * item.averageCost,
        refType: "PURCHASE_ORDER",
        refId: `PO-${rand(2000, 9999)}`,
        note: "Initial system seeding balance",
        by: "Rohit Jangid",
      });
    }
  }
  await db.inventoryStock.createMany({ data: stocksToCreate });
  await db.inventoryTransaction.createMany({ data: transactionsToCreate });

  console.log("Seeding Tyres and Major Components...");
  // Seed some tyres
  const tyreMakes = ["MRF", "Apollo", "JK Tyre", "Michelin", "Bridgestone"];
  const tyreSizes = ["10.00-20", "12.00-24", "14.00-25", "10R20"];
  const tyrePatterns = ["Lug", "Rib", "Semi-Lug", "Mining"];

  // Create 20 tyres
  for (let i = 0; i < 20; i++) {
    const isFitted = i < 12;
    const asset = isFitted ? assets[i % assets.length] : null;
    const wh = !isFitted ? pick(warehouses) : null;
    const size = pick(tyreSizes);
    const cost = rand(18000, 38000);
    const treadNew = size.includes("14.00") ? 28 : 22;
    const currentTread = isFitted ? Math.round((treadNew - rand(2, 10)) * 10) / 10 : treadNew;
    const fittedOdo = asset ? asset.meterValue - rand(1000, 15000) : 0;
    const totalKm = isFitted ? rand(5000, 20000) : 0;

    const tyre = await db.tyre.create({
      data: {
        serialNo: `TY-${100000 + i}`,
        make: pick(tyreMakes),
        size,
        pattern: pick(tyrePatterns),
        status: isFitted ? "IN_USE" : "IN_STOCK",
        cost,
        treadNewMm: treadNew,
        currentTreadMm: currentTread,
        expectedLifeKm: rand(45000, 75000),
        assetId: asset ? asset.id : null,
        position: asset ? pick(["FL", "FR", "RL1", "RL2", "RR1", "RR2"]) : null,
        fittedMeter: asset ? fittedOdo : 0,
        totalKm,
        warehouseId: wh ? wh.id : null,
      }
    });

    // Create a fitment or purchase event
    await db.tyreEvent.create({
      data: {
        tyreId: tyre.id,
        kind: isFitted ? "FIT" : "INSPECT",
        date: hoursAgo(rand(10, 500)),
        assetId: asset ? asset.id : null,
        position: tyre.position,
        meterValue: asset ? fittedOdo : 0,
        treadMm: currentTread,
        cost: isFitted ? 0 : cost,
        by: "Rohit Jangid",
        note: isFitted ? "Mounted on site during service" : "Received into store stock",
      }
    });
  }

  // Create 8 major components
  const compTypes = ["ENGINE", "TRANSMISSION", "UNDERCARRIAGE", "BUCKET"];
  const compMakes = ["Cummins", "CAT", "JCB", "Komatsu", "Allison"];
  for (let i = 0; i < 8; i++) {
    const isFitted = i < 5;
    const asset = isFitted ? assets[i % assets.length] : null;
    const wh = !isFitted ? pick(warehouses) : null;
    const cost = rand(150000, 1800000);
    const type = pick(compTypes);
    const hoursUsed = isFitted ? rand(1000, 4000) : 0;
    const fittedOdo = asset ? asset.meterValue - rand(200, 2000) : 0;

    await db.majorComponent.create({
      data: {
        serialNo: `SN-${type.slice(0, 3)}-${1000 + i}`,
        type,
        make: pick(compMakes),
        status: isFitted ? "IN_USE" : "IN_STOCK",
        cost,
        assetId: asset ? asset.id : null,
        fittedDate: asset ? hoursAgo(rand(100, 1000)) : null,
        fittedMeter: asset ? fittedOdo : 0,
        expectedLifeHours: type === "ENGINE" ? 12000 : 8000,
        hoursUsed,
        warehouseId: wh ? wh.id : null,
        notes: isFitted ? "Fitted during factory maintenance" : "Spare component stored in site warehouse",
      }
    });
  }

  const counts = {
    users: await db.user.count(),
    projects: projects.length,
    assets: assets.length,
    drivers: drivers.length,
    trips: await db.trip.count(),
    fuel: await db.fuelTransaction.count(),
    workOrders: await db.workOrder.count(),
    compliance: await db.complianceDoc.count(),
    alerts: await db.alert.count(),
    costs: await db.costTransaction.count(),
    warehouses: await db.inventoryWarehouse.count(),
    items: await db.inventoryItem.count(),
    stocks: await db.inventoryStock.count(),
    tyres: await db.tyre.count(),
    components: await db.majorComponent.count(),
  };
  console.log("Seeding complete. Counts:", counts);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("Seeding error:", e);
    await db.$disconnect();
    process.exit(1);
  });
