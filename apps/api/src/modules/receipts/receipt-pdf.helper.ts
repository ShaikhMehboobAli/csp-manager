import PDFDocument from "pdfkit";

import { mapReceiptDetail } from "./receipt.mapper";

type ReceiptDetail = ReturnType<typeof mapReceiptDetail>;

const label = (value: string | null | undefined) =>
  value ? value.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "-";

// The built-in PDF fonts have no ₹ glyph.
const rupees = (value: number | null) =>
  value === null ? "-" : `Rs. ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const istTime = (value: Date | string | null) =>
  value
    ? `${new Date(value).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })} IST`
    : "-";

/**
 * One-page PDF of a receipt as the app shows it: the main details, then the
 * optional fields the receipt carries (with their display names).
 */
export function buildReceiptPdf(receipt: ReceiptDetail): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A5", margin: 36, info: { Title: `Receipt ${receipt.receiptId}` } });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(15).text("Transaction receipt", { align: "center" });
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(9).fillColor("#555").text("CSP Manager", { align: "center" });
    doc.moveDown(1);

    doc.fillColor("#000").font("Helvetica-Bold").fontSize(20).text(rupees(receipt.amount), { align: "center" });
    doc.font("Helvetica").fontSize(10).text(label(receipt.status), { align: "center" });
    doc.moveDown(1);

    const rows: [string, string][] = [
      ["Receipt ID", receipt.receiptId],
      ["Date & time", istTime(receipt.transactionAt)],
      ["Service", label(receipt.transactionCategory)],
      ["Type", label(receipt.receiptType)],
      ["Agent", [receipt.agent.name, receipt.agent.agentId].filter(Boolean).join(" · ") || "-"],
      ["Machine", receipt.machine.machineName ?? receipt.machine.machineCode ?? "-"],
      ...receipt.fields.map(
        (field) =>
          [field.label, field.field === "balanceAfter" ? rupees(Number(field.value)) : String(field.value)] as [
            string,
            string,
          ],
      ),
    ];

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    for (const [name, value] of rows) {
      const y = doc.y;

      doc.font("Helvetica").fontSize(9).fillColor("#555").text(name, left, y, { width: width * 0.4 });
      doc.font("Helvetica").fontSize(10).fillColor("#000").text(value, left + width * 0.4, y, { width: width * 0.6 });
      doc.moveDown(0.5);
      doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor("#e5e5e5").lineWidth(0.5).stroke();
      doc.moveDown(0.5);
    }

    doc.moveDown(1);
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#777")
      .text(`Generated ${istTime(new Date())}. This is a copy of the receipt recorded by the CSP's machine.`, left, doc.y, {
        width,
        align: "center",
      });

    doc.end();
  });
}
