import { PDFDocument, StandardFonts } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConsoleLogger } from "../../modules/logger/mod.ts";
const INVOICES_BUCKET = "invoices";
function json(data: Record<string, unknown>, status: number) {
  return {
    data,
    error: status >= 400
      ? { message: String(data.error ?? "PDF_FAILED") }
      : null,
  };
}
function moneyFromCents(
  cents: number,
  currency = "EUR",
): string {
  const amount = (
    Number.isFinite(
        cents,
      )
      ? cents
      : 0
  ) / 100;

  const formatted = amount.toFixed(
    2,
  );

  if (
    currency === "EUR"
  ) {
    return `${formatted} €`;
  }

  return `${formatted} ${currency}`;
}

function isoDate(
  value: string | null | undefined,
): string {
  if (
    !value
  ) {
    return "";
  }

  const timestamp = Date.parse(
    value,
  );

  if (
    Number.isNaN(
      timestamp,
    )
  ) {
    return "";
  }

  const date = new Date(
    timestamp,
  );

  const year = date
    .getUTCFullYear();

  const month = String(
    date
      .getUTCMonth() +
      1,
  ).padStart(
    2,
    "0",
  );

  const day = String(
    date
      .getUTCDate(),
  ).padStart(
    2,
    "0",
  );

  return `${year}-${month}-${day}`;
}

function formatVatRate(
  value: unknown,
): string {
  const rate = Number(
    value ?? 0,
  );

  if (
    !Number.isFinite(
      rate,
    )
  ) {
    return "0";
  }

  return rate
    .toFixed(
      2,
    )
    .replace(
      /\.00$/,
      "",
    );
}

type InvoiceForPdf = {
  id: string;

  org_id: string;

  number: string;

  currency: string;

  subtotal_cents: number;

  vat_cents: number;

  total_cents: number;

  vat_rate: number | string | null;

  issued_at: string | null;

  paid_at: string | null;

  period_start: string | null;

  period_end: string | null;

  billing_snapshot:
    | Record<
      string,
      unknown
    >
    | null;

  pdf_path: string | null;
};

async function buildPdfBytes(
  invoice: InvoiceForPdf,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();

  const page = pdf.addPage(
    [
      595.28,
      841.89,
    ],
  );

  const font = await pdf.embedFont(
    StandardFonts.Helvetica,
  );

  const fontBold = await pdf.embedFont(
    StandardFonts.HelveticaBold,
  );

  const {
    width,
    height,
  } = page.getSize();

  const margin = 48;

  // ============================================================
  // SELLER
  // ============================================================

  const sellerLines = [
    "EventFlow",
    "Rue Feral 43",
    "5190 Ham-sur-Sambre (Belgique)",
    "TVA BE0840.386.125",
  ];

  // ============================================================
  // BUYER
  // ============================================================

  const snapshot = invoice.billing_snapshot as {
    billing?: Record<
      string,
      unknown
    >;

    billingProfile?: Record<
      string,
      unknown
    >;
  } | null;

  const billing = snapshot?.billing ??
    snapshot?.billingProfile ??
    {};

  const legalName = String(
    billing.legalName ??
      "-",
  );

  const buyerVat = [
    billing.vatCountryCode,
    billing.vatNumber,
  ]
    .filter(
      Boolean,
    )
    .join(
      " ",
    ) || "-";

  const addressLine1 = String(
    billing.addressLine1 ??
      "",
  );

  const addressLine2 = String(
    billing.addressLine2 ??
      "",
  );

  const city = [
    billing.postalCode,
    billing.city,
  ]
    .filter(
      Boolean,
    )
    .join(
      " ",
    );

  const country = String(
    billing.countryCode ??
      "",
  );

  const billingEmail = String(
    billing.billingEmail ??
      "",
  );

  const invoiceReference = String(
    billing.invoiceReference ??
      "",
  );

  // ============================================================
  // INVOICE
  // ============================================================

  const number = invoice.number ??
    "-";

  const issuedAt = isoDate(
    invoice.issued_at,
  );

  const paidAt = isoDate(
    invoice.paid_at,
  );

  const periodStart = isoDate(
    invoice.period_start,
  );

  const periodEnd = isoDate(
    invoice.period_end,
  );

  const currency = invoice.currency ??
    "EUR";

  const subtotalCents = Number(
    invoice.subtotal_cents ??
      0,
  );

  const vatCents = Number(
    invoice.vat_cents ??
      0,
  );

  const totalCents = Number(
    invoice.total_cents ??
      0,
  );

  const vatRate = formatVatRate(
    invoice.vat_rate,
  );

  // ============================================================
  // HEADER
  // ============================================================

  let yLeft = height -
    margin;

  page.drawText(
    "FACTURE",
    {
      x: margin,

      y: yLeft,

      size: 30,

      font: fontBold,
    },
  );

  yLeft -= 40;

  // ============================================================
  // SELLER BLOCK
  // ============================================================

  page.drawText(
    "Émetteur",
    {
      x: margin,

      y: yLeft,

      size: 12,

      font: fontBold,
    },
  );

  yLeft -= 16;

  for (
    const line of sellerLines
  ) {
    page.drawText(
      line,
      {
        x: margin,

        y: yLeft,

        size: 10,

        font,
      },
    );

    yLeft -= 13;
  }

  // ============================================================
  // INVOICE META
  // ============================================================

  yLeft -= 10;

  page.drawText(
    `N° E-${number}`,
    {
      x: margin,

      y: yLeft,

      size: 12,

      font: fontBold,
    },
  );

  yLeft -= 18;

  page.drawText(
    `Émise le : ${issuedAt || "-"}`,
    {
      x: margin,

      y: yLeft,

      size: 10,

      font,
    },
  );

  yLeft -= 14;

  page.drawText(
    `Payée le : ${paidAt || "-"}`,
    {
      x: margin,

      y: yLeft,

      size: 10,

      font,
    },
  );

  yLeft -= 14;

  page.drawText(
    `Période : ${periodStart || "-"} - ${periodEnd || "-"}`,
    {
      x: margin,

      y: yLeft,

      size: 10,

      font,
    },
  );

  yLeft -= 18;

  // ============================================================
  // CUSTOMER BLOCK
  // ============================================================

  const buyerX = width / 2 +
    20;

  let yRight = height -
    margin -
    40;

  page.drawText(
    "Client",
    {
      x: buyerX,

      y: yRight,

      size: 12,

      font: fontBold,
    },
  );

  yRight -= 16;

  const buyerLines = [
    legalName,

    buyerVat !== "-" ? `TVA : ${buyerVat}` : "",

    addressLine1,

    addressLine2,

    [
      city,
      country,
    ]
      .filter(
        Boolean,
      )
      .join(
        " ",
      )
      .trim(),

    billingEmail ? `Email : ${billingEmail}` : "",

    invoiceReference ? `Réf. : ${invoiceReference}` : "",
  ].filter(
    (
      line,
    ) =>
      String(
        line,
      )
        .trim()
        .length >
        0,
  );

  for (
    const line of buyerLines
  ) {
    page.drawText(
      line,
      {
        x: buyerX,

        y: yRight,

        size: 10,

        font,
      },
    );

    yRight -= 13;
  }

  // ============================================================
  // INVOICE LINE
  // ============================================================

  let y = Math.min(
    yLeft,
    yRight,
  ) -
    28;

  const descriptionX = margin;

  const amountX = width -
    margin -
    160;

  page.drawText(
    "Description",
    {
      x: descriptionX,

      y,

      size: 10,

      font: fontBold,
    },
  );

  page.drawText(
    "Montant HTVA",
    {
      x: amountX,

      y,

      size: 10,

      font: fontBold,
    },
  );

  y -= 16;

  page.drawText(
    "Abonnement EventFlow",
    {
      x: descriptionX,

      y,

      size: 10,

      font,
    },
  );

  page.drawText(
    moneyFromCents(
      subtotalCents,
      currency,
    ),
    {
      x: amountX,

      y,

      size: 10,

      font,
    },
  );

  y -= 28;

  // ============================================================
  // TOTALS
  // ============================================================

  const totalsX = width -
    margin -
    220;

  page.drawText(
    `Sous-total HTVA : ${
      moneyFromCents(
        subtotalCents,
        currency,
      )
    }`,
    {
      x: totalsX,

      y,

      size: 10,

      font,
    },
  );

  y -= 14;

  page.drawText(
    `TVA ${vatRate} % : ${
      moneyFromCents(
        vatCents,
        currency,
      )
    }`,
    {
      x: totalsX,

      y,

      size: 10,

      font,
    },
  );

  y -= 16;

  page.drawText(
    `Total TVAC : ${
      moneyFromCents(
        totalCents,
        currency,
      )
    }`,
    {
      x: totalsX,

      y,

      size: 12,

      font: fontBold,
    },
  );

  // ============================================================
  // FOOTER
  // ============================================================

  page.drawText(
    "Document généré automatiquement.",
    {
      x: margin,

      y: margin +
        10,

      size: 9,

      font,
    },
  );

  return await pdf.save();
}

export async function generateInvoicePdf(
  admin: SupabaseClient,
  invoiceId: string,
  force = false,
) {
  const logger = createConsoleLogger("invoice-pdf");
  const {
    data: invoice,

    error: invoiceError,
  } = await admin
    .from(
      "invoices",
    )
    .select(
      `
              id,
              org_id,
              number,
              currency,
              subtotal_cents,
              vat_cents,
              total_cents,
              vat_rate,
              issued_at,
              paid_at,
              period_start,
              period_end,
              billing_snapshot,
              pdf_path
            `,
    )
    .eq(
      "id",
      invoiceId,
    )
    .maybeSingle();

  if (
    invoiceError
  ) {
    logger.error(
      "invoice_load_failed",
      {
        invoiceId,

        message: invoiceError.message,

        code: invoiceError.code ??
          null,
      },
    );

    return json(
      {
        error: "DB_ERROR",

        details: invoiceError.message,
      },
      500,
    );
  }

  if (
    !invoice?.id
  ) {
    logger.warn(
      "invoice_not_found",
      {
        invoiceId,
      },
    );

    return json(
      {
        error: "NOT_FOUND",
      },
      404,
    );
  }

  if (
    !invoice.org_id ||
    !invoice.number
  ) {
    logger.error(
      "invoice_data_invalid",
      {
        invoiceId,

        hasOrgId: Boolean(
          invoice.org_id,
        ),

        hasNumber: Boolean(
          invoice.number,
        ),
      },
    );

    return json(
      {
        error: "VALIDATION_ERROR: invoice missing org_id/number",
      },
      400,
    );
  }

  logger.info(
    "invoice_loaded",
    {
      invoiceId: invoice.id,

      invoiceNumber: invoice.number,

      orgId: invoice.org_id,

      subtotalCents: invoice.subtotal_cents,

      vatCents: invoice.vat_cents,

      totalCents: invoice.total_cents,

      vatRate: invoice.vat_rate,

      hasExistingPdf: Boolean(
        invoice.pdf_path,
      ),
    },
  );

  const yearFromNumber = String(
    invoice.number,
  ).slice(
    0,
    4,
  );

  const year = /^\d{4}$/.test(
      yearFromNumber,
    )
    ? yearFromNumber
    : String(
      new Date()
        .getUTCFullYear(),
    );

  const clientPath = `${invoice.org_id}/${year}/${invoice.number}.pdf`;

  const accountingPath = `accounting/${year}/${invoice.number}.pdf`;

  logger.info(
    "pdf_build_start",
    {
      invoiceId: invoice.id,

      clientPath,

      accountingPath,
    },
  );

  let pdfBytes: Uint8Array;

  try {
    pdfBytes = await buildPdfBytes(
      invoice as InvoiceForPdf,
    );
  } catch (error) {
    logger.error(
      "pdf_build_failed",
      {
        invoiceId: invoice.id,

        message: error instanceof
            Error
          ? error.message
          : String(
            error,
          ),
      },
    );

    return json(
      {
        error: "PDF_BUILD_FAILED",
      },
      500,
    );
  }

  logger.info(
    "pdf_built",
    {
      invoiceId: invoice.id,

      bytes: pdfBytes.byteLength,
    },
  );

  const uploadOptions = {
    contentType: "application/pdf",

    upsert: force,
  };

  const clientUpload = await admin.storage
    .from(
      INVOICES_BUCKET,
    )
    .upload(
      clientPath,
      pdfBytes,
      uploadOptions,
    );

  if (
    clientUpload.error &&
    !force
  ) {
    const message = String(
      clientUpload.error.message ??
        clientUpload.error,
    );

    const alreadyExists = message
      .toLowerCase()
      .includes(
        "already exists",
      ) ||
      message
        .toLowerCase()
        .includes(
          "duplicate",
        ) ||
      message
        .toLowerCase()
        .includes(
          "exists",
        );

    if (
      !alreadyExists
    ) {
      logger.error(
        "client_pdf_upload_failed",
        {
          invoiceId: invoice.id,

          clientPath,

          message,
        },
      );

      return json(
        {
          error: "UPLOAD_FAILED_CLIENT",

          details: message,
        },
        500,
      );
    }

    logger.info(
      "client_pdf_already_exists",
      {
        invoiceId: invoice.id,

        clientPath,
      },
    );
  } else {
    logger.info(
      "client_pdf_uploaded",
      {
        invoiceId: invoice.id,

        clientPath,
      },
    );
  }

  const accountingUpload = await admin.storage
    .from(
      INVOICES_BUCKET,
    )
    .upload(
      accountingPath,
      pdfBytes,
      uploadOptions,
    );

  if (
    accountingUpload.error &&
    !force
  ) {
    const message = String(
      accountingUpload.error.message ??
        accountingUpload.error,
    );

    const alreadyExists = message
      .toLowerCase()
      .includes(
        "already exists",
      ) ||
      message
        .toLowerCase()
        .includes(
          "duplicate",
        ) ||
      message
        .toLowerCase()
        .includes(
          "exists",
        );

    if (
      !alreadyExists
    ) {
      logger.error(
        "accounting_pdf_upload_failed",
        {
          invoiceId: invoice.id,

          accountingPath,

          message,
        },
      );

      return json(
        {
          error: "UPLOAD_FAILED_ACCOUNTING",

          details: message,
        },
        500,
      );
    }

    logger.info(
      "accounting_pdf_already_exists",
      {
        invoiceId: invoice.id,

        accountingPath,
      },
    );
  } else {
    logger.info(
      "accounting_pdf_uploaded",
      {
        invoiceId: invoice.id,

        accountingPath,
      },
    );
  }

  if (
    !invoice.pdf_path ||
    force
  ) {
    const {
      error: pdfPathError,
    } = await admin.rpc(
      "rpc_set_invoice_pdf_path",
      {
        p_invoice_id: invoice.id,

        p_pdf_path: clientPath,
      },
    );

    if (
      pdfPathError
    ) {
      logger.error(
        "invoice_pdf_path_update_failed",
        {
          invoiceId: invoice.id,

          clientPath,

          message: pdfPathError.message,
        },
      );

      return json(
        {
          error: "SET_PDF_PATH_FAILED",

          details: pdfPathError.message,
        },
        500,
      );
    }

    logger.info(
      "invoice_pdf_path_updated",
      {
        invoiceId: invoice.id,

        clientPath,
      },
    );
  }

  logger.info(
    "completed",
    {
      invoiceId: invoice.id,

      invoiceNumber: invoice.number,

      pdfPath: clientPath,

      force,
    },
  );

  return json(
    {
      ok: true,

      invoice_id: invoice.id,

      pdf_path: clientPath,
    },
    200,
  );
}
