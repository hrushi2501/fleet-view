/**
 * The payroll sheet as a file somebody can file, email or hand to an auditor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two formats because they answer different questions. The Excel sheet is for
 * working with — sorting, totalling, pasting into a bank upload. The PDF is for
 * the record: it is what gets signed, filed, and produced a year later when
 * somebody disputes a month.
 *
 * Both carry the same figures from the same stored line, so they cannot drift
 * apart, and both state whether the run was still a draft — an unsigned draft
 * that looks like a final sheet is how the wrong numbers get paid.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A note on the rupee sign
 *
 * The PDF uses "Rs." rather than "₹". PDFKit's built-in fonts are WinAnsi, and
 * ₹ (U+20B9) is not in that character set — it renders as a wrong glyph or
 * nothing at all. A payslip with a mangled currency symbol invites exactly the
 * doubt this document exists to remove, so it is spelled out instead. The Excel
 * export has no such limit and uses a proper ₹ number format.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export type PayrollExportLine = {
  empCode: string;
  name: string;
  wageKind: string;
  wageAmount: number;
  daysPresent: number;
  daysHalf: number;
  daysLeave: number;
  daysAbsent: number;
  daysRest: number;
  daysPaid: number;
  otHours: number;
  basic: number;
  overtime: number;
  bonus: number;
  advance: number;
  deduction: number;
  net: number;
  adjustedNote: string | null;
};

export type PayrollExportRun = {
  period: string;
  status: string;
  standardDays: number;
  standardHours: number;
  finalisedAt: Date | null;
  finalisedBy: string | null;
  lines: PayrollExportLine[];
};

/** `2026-08` → `August 2026`, for a heading a person reads. */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const name = new Date(Date.UTC(y!, m! - 1, 1)).toLocaleString("en-GB", {
    month: "long",
    timeZone: "UTC",
  });
  return `${name} ${y}`;
}

function totals(lines: PayrollExportLine[]) {
  return lines.reduce(
    (t, l) => ({
      basic: t.basic + l.basic,
      overtime: t.overtime + l.overtime,
      bonus: t.bonus + l.bonus,
      advance: t.advance + l.advance,
      deduction: t.deduction + l.deduction,
      net: t.net + l.net,
      daysPaid: t.daysPaid + l.daysPaid,
    }),
    { basic: 0, overtime: 0, bonus: 0, advance: 0, deduction: 0, net: 0, daysPaid: 0 },
  );
}

/* --------------------------------- Excel --------------------------------- */

const RUPEE_FORMAT = '"₹"#,##0.00';

export async function payrollWorkbook(run: PayrollExportRun, company: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = company;
  wb.created = new Date();

  const ws = wb.addWorksheet(`Payroll ${run.period}`, {
    views: [{ state: "frozen", ySplit: 4 }],
  });

  ws.mergeCells("A1:Q1");
  ws.getCell("A1").value = `${company} — Payroll for ${periodLabel(run.period)}`;
  ws.getCell("A1").font = { bold: true, size: 14 };

  ws.mergeCells("A2:Q2");
  ws.getCell("A2").value =
    run.status === "FINALISED"
      ? `Finalised${run.finalisedAt ? ` on ${run.finalisedAt.toLocaleDateString("en-GB")}` : ""}${
          run.finalisedBy ? ` by ${run.finalisedBy}` : ""
        }`
      : "DRAFT — not yet approved for payment";
  ws.getCell("A2").font = { italic: true, color: { argb: run.status === "FINALISED" ? "FF15803D" : "FFB45309" } };

  ws.mergeCells("A3:Q3");
  ws.getCell("A3").value = `A full month is ${run.standardDays} days; a normal shift is ${run.standardHours} hours.`;
  ws.getCell("A3").font = { size: 9, color: { argb: "FF64748B" } };

  ws.getRow(4).values = [
    "Emp Code", "Name", "Wage Type", "Wage Rate",
    "Present", "Half Day", "Leave", "Rest", "Absent", "Days Paid",
    "OT Hours", "Basic", "Overtime", "Bonus", "Advance", "Deduction", "Net Payable", "Note",
  ];
  ws.getRow(4).font = { bold: true };
  ws.getRow(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };

  ws.columns = [
    { width: 12 }, { width: 24 }, { width: 11 }, { width: 12 },
    { width: 9 }, { width: 10 }, { width: 8 }, { width: 8 }, { width: 9 }, { width: 11 },
    { width: 10 }, { width: 13 }, { width: 12 }, { width: 11 }, { width: 12 }, { width: 12 },
    { width: 14 }, { width: 30 },
  ];

  for (const l of run.lines) {
    ws.addRow([
      l.empCode, l.name, l.wageKind === "MONTHLY" ? "Monthly" : "Daily", l.wageAmount,
      l.daysPresent, l.daysHalf, l.daysLeave, l.daysRest, l.daysAbsent, l.daysPaid,
      l.otHours, l.basic, l.overtime, l.bonus, l.advance, l.deduction, l.net,
      l.adjustedNote ?? "",
    ]);
  }

  const t = totals(run.lines);
  const totalRow = ws.addRow([
    "", `TOTAL — ${run.lines.length} people`, "", "",
    "", "", "", "", "", t.daysPaid,
    "", t.basic, t.overtime, t.bonus, t.advance, t.deduction, t.net, "",
  ]);
  totalRow.font = { bold: true };
  totalRow.border = { top: { style: "double" } };

  // Money columns get a rupee format so the file is usable without reformatting.
  for (const col of ["D", "L", "M", "N", "O", "P", "Q"]) {
    ws.getColumn(col).numFmt = RUPEE_FORMAT;
  }
  ws.autoFilter = { from: "A4", to: { row: 4, column: 18 } };

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/* ---------------------------------- PDF ---------------------------------- */

/** Rupees for a WinAnsi font. See the note at the top of this file. */
function rs(n: number): string {
  return `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function payrollPdf(run: PayrollExportRun, company: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 28 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = 28;
    const right = doc.page.width - 28;

    doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a")
      .text(`${company}`, left, 30);
    doc.font("Helvetica").fontSize(11).fillColor("#334155")
      .text(`Payroll for ${periodLabel(run.period)}`, left, 50);

    const draft = run.status !== "FINALISED";
    doc.font("Helvetica-Bold").fontSize(10).fillColor(draft ? "#b45309" : "#15803d")
      .text(
        draft
          ? "DRAFT — not yet approved for payment"
          : `FINALISED${run.finalisedAt ? ` on ${run.finalisedAt.toLocaleDateString("en-GB")}` : ""}${
              run.finalisedBy ? ` by ${run.finalisedBy}` : ""
            }`,
        left,
        68,
      );

    doc.font("Helvetica").fontSize(8).fillColor("#64748b")
      .text(
        `A full month is ${run.standardDays} days; a normal shift is ${run.standardHours} hours. Amounts in Indian Rupees.`,
        left,
        84,
      );

    // Columns sized to the widest realistic value, so nothing collides.
    const cols: { label: string; w: number; align: "left" | "right" }[] = [
      { label: "Code", w: 52, align: "left" },
      { label: "Name", w: 118, align: "left" },
      { label: "Type", w: 44, align: "left" },
      { label: "Rate", w: 60, align: "right" },
      { label: "Pres", w: 32, align: "right" },
      { label: "Half", w: 30, align: "right" },
      { label: "Leave", w: 34, align: "right" },
      { label: "Rest", w: 30, align: "right" },
      { label: "Abs", w: 30, align: "right" },
      { label: "Paid", w: 34, align: "right" },
      { label: "OT hr", w: 36, align: "right" },
      { label: "Basic", w: 68, align: "right" },
      { label: "OT", w: 56, align: "right" },
      { label: "Bonus", w: 56, align: "right" },
      { label: "Advance", w: 62, align: "right" },
      { label: "Deduct", w: 58, align: "right" },
      { label: "Net", w: 72, align: "right" },
    ];

    let y = 104;

    const header = () => {
      doc.rect(left, y - 4, right - left, 18).fill("#f1f5f9");
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#334155");
      let x = left + 2;
      for (const c of cols) {
        doc.text(c.label, x, y, { width: c.w - 4, align: c.align });
        x += c.w;
      }
      y += 18;
    };

    header();
    doc.font("Helvetica").fontSize(7.5).fillColor("#0f172a");

    for (const l of run.lines) {
      // Start a new page before the row rather than after, so a row is never
      // split across the fold.
      if (y > doc.page.height - 70) {
        doc.addPage({ size: "A4", layout: "landscape", margin: 28 });
        y = 40;
        header();
        doc.font("Helvetica").fontSize(7.5).fillColor("#0f172a");
      }

      const cells = [
        l.empCode,
        l.name.length > 24 ? `${l.name.slice(0, 23)}…` : l.name,
        l.wageKind === "MONTHLY" ? "Monthly" : "Daily",
        rs(l.wageAmount),
        String(l.daysPresent),
        String(l.daysHalf),
        String(l.daysLeave),
        String(l.daysRest),
        String(l.daysAbsent),
        String(l.daysPaid),
        String(l.otHours),
        rs(l.basic),
        rs(l.overtime),
        rs(l.bonus),
        rs(l.advance),
        rs(l.deduction),
        rs(l.net),
      ];

      let x = left + 2;
      cells.forEach((v, i) => {
        const c = cols[i]!;
        doc.text(v, x, y, { width: c.w - 4, align: c.align, lineBreak: false });
        x += c.w;
      });

      y += 14;
      doc.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
    }

    const t = totals(run.lines);
    y += 4;
    doc.moveTo(left, y).lineTo(right, y).strokeColor("#0f172a").lineWidth(1).stroke();
    y += 6;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a");

    let x = left + 2;
    const totalCells = [
      "", `TOTAL — ${run.lines.length} people`, "", "", "", "", "", "", "",
      String(Math.round(t.daysPaid * 10) / 10), "",
      rs(t.basic), rs(t.overtime), rs(t.bonus), rs(t.advance), rs(t.deduction), rs(t.net),
    ];
    totalCells.forEach((v, i) => {
      const c = cols[i]!;
      doc.text(v, x, y, { width: c.w - 4, align: c.align, lineBreak: false });
      x += c.w;
    });

    // Signature blocks: this sheet is what gets signed when cash changes hands.
    y += 34;
    if (y > doc.page.height - 60) {
      doc.addPage({ size: "A4", layout: "landscape", margin: 28 });
      y = 60;
    }
    doc.font("Helvetica").fontSize(8).fillColor("#334155");
    const blockW = (right - left) / 3;
    ["Prepared by", "Approved by", "Received by"].forEach((label, i) => {
      const bx = left + i * blockW;
      doc.moveTo(bx, y).lineTo(bx + blockW - 30, y).strokeColor("#94a3b8").lineWidth(0.5).stroke();
      doc.text(label, bx, y + 4);
    });

    doc.end();
  });
}
