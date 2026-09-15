import {
  PDFDocument,
  StandardFonts,
  rgb,
} from "https://esm.sh/pdf-lib@1.17.1";
import QRCode from "https://esm.sh/qrcode@1.5.4";

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

function fitText(s, max = 80) {
  const t = String(s ?? "").trim();

  if (t.length <= max) return t;

  return t.slice(0, max - 1).trimEnd() + "…";
}

function formatBrussels(iso) {
  if (!iso) return null;

  const d = new Date(iso);

  if (!Number.isFinite(d.getTime())) return iso;

  return new Intl.DateTimeFormat("fr-BE", {
    timeZone: "Europe/Brussels",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function formatMoney(cents, currency) {
  const n = Number(cents ?? 0) / 100;

  try {
    return new Intl.NumberFormat("fr-BE", {
      style: "currency",
      currency,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

function drawQrCodeMatrix(page, text, x, y, size) {
  const qr = QRCode.create(text, {
    errorCorrectionLevel: "M",
  });

  const modules = qr.modules;
  const count = modules.size;
  const cell = size / count;

  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!modules.get(row, col)) continue;

      page.drawRectangle({
        x: x + col * cell,
        y: y + (count - 1 - row) * cell,
        width: cell,
        height: cell,
        color: rgb(0, 0, 0),
      });
    }
  }
}

export async function generateTicketsPdf(input) {
  const pdf = await PDFDocument.create();

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  function sanitizePdfText(value, targetFont = font) {
    const text = String(value ?? "");
    let result = "";

    for (const char of text) {
      try {
        targetFont.encodeText(char);
        result += char;
      } catch {
        // Caractère non supporté par WinAnsi :
        // emoji ou autre caractère Unicode non disponible
        // dans les polices PDF standards.
      }
    }

    return result;
  }

  function fitPdfText(value, max = 80, targetFont = font) {
    return fitText(
      sanitizePdfText(value, targetFont),
      max,
    );
  }

  const pageWidth = 595.28;
  const pageHeight = 841.89;

  const margin = 28;
  const gap = 16;

  const ticketWidth = pageWidth - margin * 2;
  const ticketHeight = (pageHeight - margin * 2 - gap) / 2;

  const textColor = rgb(0.10, 0.10, 0.11);
  const muted = rgb(0.44, 0.46, 0.50);
  const softMuted = rgb(0.60, 0.62, 0.66);
  const border = rgb(0.86, 0.87, 0.89);
  const soft = rgb(0.965, 0.965, 0.972);
  const secondaryBg = rgb(0.985, 0.986, 0.99);
  const accent = rgb(0.20, 0.20, 0.22);

  function drawLabel(page, label, x, y) {
    page.drawText(
      sanitizePdfText(label, fontBold),
      {
        x,
        y,
        size: 8.5,
        font: fontBold,
        color: muted,
      },
    );
  }

  function drawValue(
    page,
    value,
    x,
    y,
    maxWidth,
    size = 11,
    bold = false,
    color = textColor,
  ) {
    const targetFont = bold ? fontBold : font;

    page.drawText(
      fitPdfText(value, 120, targetFont),
      {
        x,
        y,
        size,
        font: targetFont,
        color,
        maxWidth,
      },
    );
  }

  function drawLabelValue(
    page,
    label,
    value,
    x,
    y,
    maxWidth,
    valueSize = 11,
    boldValue = false,
    valueColor = textColor,
  ) {
    drawLabel(page, label, x, y);

    drawValue(
      page,
      value,
      x,
      y - 14,
      maxWidth,
      valueSize,
      boldValue,
      valueColor,
    );
  }

  function drawDivider(page, x, y, width) {
    page.drawLine({
      start: {
        x,
        y,
      },
      end: {
        x: x + width,
        y,
      },
      thickness: 1,
      color: border,
    });
  }

  function drawParticipantBox(page, lines, x, topY, width) {
    const safeLines = lines.slice(0, 2);

    if (!safeLines.length) return topY;

    const paddingX = 12;
    const paddingTop = 10;
    const paddingBottom = 10;
    const lineHeight = 12;
    const labelGap = 16;

    const boxHeight =
      paddingTop +
      labelGap +
      safeLines.length * lineHeight +
      paddingBottom;

    const boxY = topY - boxHeight;

    page.drawRectangle({
      x,
      y: boxY,
      width,
      height: boxHeight,
      color: rgb(0.985, 0.987, 0.992),
      borderColor: border,
      borderWidth: 1,
    });

    drawLabel(
      page,
      "Participant",
      x + paddingX,
      topY - 14,
    );

    let lineY = topY - 30;

    for (const line of safeLines) {
      drawValue(
        page,
        line,
        x + paddingX,
        lineY,
        width - paddingX * 2,
        9.6,
        false,
        accent,
      );

      lineY -= lineHeight;
    }

    return boxY - 16;
  }

  function drawFooter(
    page,
    x,
    y,
    width,
    orderId,
    qrToken,
  ) {
    drawDivider(
      page,
      x,
      y + 28,
      width,
    );

    drawLabel(
      page,
      "Commande",
      x,
      y + 12,
    );

    drawValue(
      page,
      `…${orderId.slice(-8)}`,
      x,
      y - 2,
      width,
      8.6,
      false,
      softMuted,
    );

    drawLabel(
      page,
      "Référence billet",
      x,
      y - 20,
    );

    drawValue(
      page,
      `…${qrToken.slice(-8)}`,
      x,
      y - 34,
      width,
      8.4,
      false,
      softMuted,
    );
  }

  for (let i = 0; i < input.tickets.length; i += 2) {
    const page = pdf.addPage([
      pageWidth,
      pageHeight,
    ]);

    for (let slot = 0; slot < 2; slot++) {
      const ticket = input.tickets[i + slot];

      if (!ticket) continue;

      const isPrimary = ticket.creates_attendees;

      const x = margin;

      const y =
        pageHeight -
        margin -
        ticketHeight -
        slot * (ticketHeight + gap);

      page.drawRectangle({
        x,
        y,
        width: ticketWidth,
        height: ticketHeight,
        borderColor: border,
        borderWidth: 1,
        color: isPrimary
          ? rgb(1, 1, 1)
          : secondaryBg,
      });

      page.drawRectangle({
        x: x + 18,
        y: y + ticketHeight - 50,
        width: ticketWidth - 36,
        height: 30,
        color: soft,
      });

      page.drawText("Billet Eventflow", {
        x: x + 26,
        y: y + ticketHeight - 39,
        size: 10.5,
        font: fontBold,
        color: softMuted,
      });

      const qrSize = isPrimary ? 118 : 96;

      const qrX =
        x +
        ticketWidth -
        qrSize -
        28;

      const qrY =
        y +
        ticketHeight -
        qrSize -
        84;

      page.drawRectangle({
        x: qrX - 7,
        y: qrY - 7,
        width: qrSize + 14,
        height: qrSize + 14,
        color: rgb(1, 1, 1),
        borderColor: border,
        borderWidth: 1,
      });

      drawQrCodeMatrix(
        page,
        ticket.qr_token,
        qrX,
        qrY,
        qrSize,
      );

      page.drawText(
        "QR à présenter à l’entrée",
        {
          x: qrX,
          y: qrY - 16,
          size: 8.8,
          font: fontBold,
          color: muted,
        },
      );

      const leftX = x + 26;

      const leftWidth =
        ticketWidth -
        qrSize -
        126;

      const titleY =
        y +
        ticketHeight -
        86;

      const footerBaseY = y + 42;

      const footerReservedTopY =
        footerBaseY + 34;

      const contentBottomY =
        footerReservedTopY + 18;

      page.drawText(
        fitPdfText(
          input.eventTitle,
          58,
          fontBold,
        ),
        {
          x: leftX,
          y: titleY,
          size: isPrimary ? 17.5 : 15,
          font: fontBold,
          color: accent,
          maxWidth: leftWidth,
        },
      );

      let cursorY = titleY - 26;

      if (
        ticket.creates_attendees &&
        ticket.attendee_summary_lines.length > 0
      ) {
        cursorY = drawParticipantBox(
          page,
          ticket.attendee_summary_lines,
          leftX,
          cursorY,
          leftWidth,
        );
      }

      if (
        input.startsAt &&
        cursorY - 28 >= contentBottomY
      ) {
        drawLabelValue(
          page,
          "Date",
          formatBrussels(input.startsAt) ??
            input.startsAt,
          leftX,
          cursorY,
          leftWidth,
          10.8,
        );

        cursorY -= 40;
      }

      if (
        input.location &&
        cursorY - 28 >= contentBottomY
      ) {
        drawLabelValue(
          page,
          "Lieu",
          input.location,
          leftX,
          cursorY,
          leftWidth,
          10.8,
        );

        cursorY -= 40;
      }

      if (
        cursorY - 28 >= contentBottomY
      ) {
        drawLabelValue(
          page,
          "Billet",
          ticket.product_name_snapshot ||
            "Billet",
          leftX,
          cursorY,
          leftWidth,
          11.2,
          true,
        );

        cursorY -= 40;
      }

      if (ticket.creates_attendees) {
        if (
          cursorY - 28 >= contentBottomY
        ) {
          drawLabelValue(
            page,
            "Prix",
            formatMoney(
              ticket.unit_price_cents,
              input.currency,
            ),
            leftX,
            cursorY,
            120,
            10.8,
            true,
          );

          drawLabelValue(
            page,
            "Accès",
            `${Math.max(
              1,
              ticket.admits_count,
            )} entrée(s)`,
            leftX + 150,
            cursorY,
            110,
            10.8,
            true,
          );

          cursorY -= 40;
        }
      } else {
        if (
          cursorY - 34 >= contentBottomY
        ) {
          page.drawRectangle({
            x: leftX - 2,
            y: cursorY - 24,
            width: leftWidth + 4,
            height: 34,
            color: rgb(
              0.99,
              0.99,
              0.993,
            ),
            borderColor: border,
            borderWidth: 1,
          });

          drawValue(
            page,
            "Billet non nominatif",
            leftX + 8,
            cursorY - 10,
            leftWidth - 16,
            10,
            true,
            muted,
          );

          drawValue(
            page,
            "Aucun participant lié à ce billet.",
            leftX + 8,
            cursorY - 22,
            leftWidth - 16,
            9.2,
            false,
            softMuted,
          );

          cursorY -= 46;
        }
      }

      drawFooter(
        page,
        leftX,
        footerBaseY,
        leftWidth,
        input.orderId,
        ticket.qr_token,
      );
    }
  }

  const pdfBytes = await pdf.save();

  return {
    filename: `billets-${input.orderId}.pdf`,
    contentBase64: bytesToBase64(pdfBytes),
    contentType: "application/pdf",
  };
}