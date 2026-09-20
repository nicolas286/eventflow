import { escapeHtml } from "../../../text.ts";
import { markdownToSafeHtml } from "../../../markdown.ts";
import { formatDateTimeBrussels, formatMoney } from "../../../format.ts";

export function buildOrderConfirmationHtml(
  p: {
    eventTitle: string;
    startsAt: string | null;
    location: string | null;
    description: string | null;
    orderUrl: string;
    currency: string;
    items: Array<
      { name: string; qty: number; unitCents: number; lineCents: number }
    >;
    totalCents: number;
    paidCents: number;
    discountCents?: number;
    dueCents?: number;
    reminderDays?: number;
  },
) {
  const title = escapeHtml(p.eventTitle);
  const when = formatDateTimeBrussels(p.startsAt ?? null);
  const location = String(p.location ?? "").trim();

  const descHtml = markdownToSafeHtml(p.description, {
    maxLength: 1200,
  });

  const total = Math.max(0, Number(p.totalCents ?? 0));
  const discount = Math.max(0, Number(p.discountCents ?? 0));
  const paid = Math.max(0, Number(p.paidCents ?? 0));

  const due = Number.isFinite(Number(p.dueCents))
    ? Math.max(0, Number(p.dueCents ?? 0))
    : Math.max(0, total - discount - paid);

  const itemsRows = p.items
    .filter((x) => x.qty > 0)
    .map((x) => {
      return `
<tr>
<td style="padding:10px 12px;border-top:1px solid #eee;">
<div style="font-weight:700">${escapeHtml(x.name)}</div>
</td>

<td style="padding:10px 12px;border-top:1px solid #eee;text-align:center;">
${x.qty}
</td>

<td style="padding:10px 12px;border-top:1px solid #eee;text-align:right;">
${escapeHtml(formatMoney(x.unitCents, p.currency))}
</td>

<td style="padding:10px 12px;border-top:1px solid #eee;text-align:right;font-weight:700;">
${escapeHtml(formatMoney(x.lineCents, p.currency))}
</td>
</tr>
`;
    })
    .join("");

  const itemsTable = p.items.length
    ? `
<div style="margin:14px 0 6px;font-weight:800">Billets</div>

<div style="border:1px solid #eee;border-radius:14px;overflow:hidden;background:#fff">
<table style="width:100%;border-collapse:collapse;font-size:14px">

<thead>
<tr style="background:#f6f6f7">
<th style="padding:10px 12px;text-align:left;">Type</th>
<th style="padding:10px 12px;text-align:center;">Qté</th>
<th style="padding:10px 12px;text-align:right;">Prix</th>
<th style="padding:10px 12px;text-align:right;">Total</th>
</tr>
</thead>

<tbody>
${
      itemsRows ||
      `<tr><td colspan="4" style="padding:12px;color:#666">Aucun billet trouvé.</td></tr>`
    }
</tbody>

</table>
</div>

<div style="margin-top:10px;text-align:right;font-size:14px">

<div style="margin:4px 0">
<span style="opacity:.75">Total :</span>
<strong>${escapeHtml(formatMoney(total, p.currency))}</strong>
</div>

${
      discount > 0
        ? `<div style="margin:4px 0">
<span style="opacity:.75">Remise :</span>
<strong>- ${escapeHtml(formatMoney(discount, p.currency))}</strong>
</div>`
        : ""
    }

<div style="margin:4px 0">
<span style="opacity:.75">Payé :</span>
<strong>${escapeHtml(formatMoney(paid, p.currency))}</strong>
</div>

${
      due > 0
        ? `<div style="margin:4px 0">
<span style="opacity:.75">Reste à payer :</span>
<strong>${escapeHtml(formatMoney(due, p.currency))}</strong>
</div>`
        : ""
    }

</div>
`
    : ``;

  return `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.6;color:#111;background:#fafafa;padding:24px">

<div style="max-width:680px;margin:0 auto">

<div style="background:#fff;border:1px solid #eee;border-radius:16px;padding:20px">

<div style="font-size:18px;font-weight:900;margin:0 0 10px">
🎟️ Inscription confirmée
</div>

<div style="margin:0 0 14px;color:#333">
Vous êtes bien inscrit·e à l’événement :
</div>

<div style="background:#f6f6f7;border-radius:14px;padding:14px 16px;margin:0 0 14px">

<div style="font-weight:900;font-size:16px;margin:0 0 6px">
${title}
</div>

${
    when
      ? `<div style="margin:6px 0;font-size:13px;opacity:.85">
<span style="font-weight:800">🗓️ Date</span> : ${escapeHtml(when)}
</div>`
      : ""
  }

${
    location
      ? `<div style="margin:6px 0;font-size:13px;opacity:.85">
<span style="font-weight:800">📍 Lieu</span> : ${escapeHtml(location)}
</div>`
      : ""
  }

</div>

${itemsTable}

${
    p.orderUrl
      ? `
<div style="text-align:center;margin:18px 0">
  <a href="${escapeHtml(p.orderUrl)}"
     style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:999px">
    Voir ma commande
  </a>
</div>
`
      : ""
  }

${
    descHtml
      ? `
<div style="margin:16px 0 8px;font-weight:900">Détails</div>

<div style="font-size:14px;color:#333;opacity:.95">
${descHtml}
</div>
`
      : ""
  }

</div>

<div style="text-align:center;font-size:11px;opacity:.55;margin-top:12px">
Eventflow
</div>

</div>
</div>
`;
}
