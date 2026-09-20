import type { SupabaseClient } from "@supabase/supabase-js";
import { runInBackground } from "../../app/background.ts";
import { generateInvoicePdf } from "../invoice-pdf/index.ts";
import { assertBillitEnabled } from "../../environment-safety.ts";
import { createConsoleLogger } from "../../modules/logger/mod.ts";
function json(data: Record<string, unknown>, status: number) {
  return {
    data,
    error: status >= 400
      ? { message: String(data.error ?? "BILLIT_FAILED") }
      : null,
  };
}
type Logger = {
  info: (
    event: string,
    metadata?: Record<
      string,
      unknown
    >,
  ) => void;

  warn: (
    event: string,
    metadata?: Record<
      string,
      unknown
    >,
  ) => void;

  error: (
    event: string,
    metadata?: Record<
      string,
      unknown
    >,
  ) => void;
};

type SellerConfig = {
  name: string;

  vat: string;

  country: string;

  endpointId: string;

  street: string;

  city: string;

  postalCode: string;
};

function escapeXml(
  value: unknown,
): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(
    value,
  )
    .replace(
      /&/g,
      "&amp;",
    )
    .replace(
      /</g,
      "&lt;",
    )
    .replace(
      />/g,
      "&gt;",
    )
    .replace(
      /"/g,
      "&quot;",
    )
    .replace(
      /'/g,
      "&apos;",
    );
}

function money(
  cents: number,
): string {
  return (
    cents /
    100
  ).toFixed(
    2,
  );
}

function isoDate(
  value:
    | string
    | Date
    | null
    | undefined,
): string {
  if (
    !value
  ) {
    return new Date()
      .toISOString()
      .slice(
        0,
        10,
      );
  }

  const date = typeof value ===
      "string"
    ? new Date(
      value,
    )
    : value;

  return date
    .toISOString()
    .slice(
      0,
      10,
    );
}

function safeStr(
  value: unknown,
  max = 500,
): string {
  const stringValue = String(
    value ??
      "",
  );

  if (
    stringValue.length <=
      max
  ) {
    return stringValue;
  }

  return stringValue.slice(
    0,
    max,
  );
}

function clean(
  value: unknown,
  fallback = "",
): string {
  const stringValue = String(
    value ??
      "",
  ).trim();

  return (
    stringValue ||
    fallback
  );
}

function formatVatPercent(
  value: unknown,
): string {
  const rate = Number(
    value ??
      0,
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

function hasBuyerPeppolData(
  billing: Record<
    string,
    unknown
  >,
): boolean {
  const legalName = clean(
    billing.legalName,
  );

  const countryCode = clean(
    billing.countryCode,
  );

  const vatCountryCode = clean(
    billing.vatCountryCode,
  );

  const vatNumber = clean(
    billing.vatNumber,
  );

  return Boolean(
    legalName &&
      countryCode &&
      vatCountryCode &&
      vatNumber,
  );
}

function normalizeVatNumber(
  countryCode: string,
  vatNumber: string,
): string {
  const normalizedCountry = countryCode
    .replace(
      /\s+/g,
      "",
    )
    .toUpperCase();

  const normalizedNumber = vatNumber
    .replace(
      /\s+/g,
      "",
    )
    .replace(
      new RegExp(
        `^${normalizedCountry}`,
        "i",
      ),
      "",
    );

  if (
    !normalizedCountry ||
    !normalizedNumber
  ) {
    return "";
  }

  return `${normalizedCountry}${normalizedNumber}`;
}

function normalizeEndpointId(
  value: string,
): string {
  return value
    .replace(
      /^0208:/,
      "",
    )
    .replace(
      /\s+/g,
      "",
    );
}

function buildUblInvoice(
  invoice: Record<
    string,
    unknown
  >,
  seller: SellerConfig,
): string {
  const snapshot = invoice.billing_snapshot as {
    billing?: Record<
      string,
      unknown
    >;
  } | null;

  const billing = snapshot?.billing ??
    {};

  const sellerVat = clean(
    seller.vat,
  );

  const sellerEndpointId = normalizeEndpointId(
    clean(
      seller.endpointId,
    ),
  );

  const buyerName = clean(
    billing.legalName,
  );

  const buyerCountry = clean(
    billing.countryCode,
  );

  const buyerStreet = clean(
    billing.addressLine1,
  );

  const buyerStreet2 = clean(
    billing.addressLine2,
  );

  const buyerCity = clean(
    billing.city,
  );

  const buyerPostalCode = clean(
    billing.postalCode,
  );

  const buyerVatCountry = clean(
    billing.vatCountryCode,
  );

  const buyerVatNumber = clean(
    billing.vatNumber,
  );

  const buyerVat = normalizeVatNumber(
    buyerVatCountry,
    buyerVatNumber,
  );

  const buyerEndpointId = buyerVat
    ? normalizeEndpointId(
      buyerVat,
    )
    : "";

  const currency = clean(
    invoice.currency,
    "EUR",
  );

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

  /*
   * Ne pas recalculer le taux avec vat/subtotal.
   *
   * Les montants sont arrondis au centime, ce qui pourrait
   * produire un faux taux comme 21,04 %.
   */
  const vatPercent = formatVatPercent(
    invoice.vat_rate,
  );

  const subtotal = money(
    subtotalCents,
  );

  const vat = money(
    vatCents,
  );

  const total = money(
    totalCents,
  );

  const issueDate = isoDate(
    invoice.issued_at as
      | string
      | null
      | undefined,
  );

  const dueDate = isoDate(
    (
      invoice.paid_at ??
        invoice.issued_at
    ) as
      | string
      | null
      | undefined,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice
  xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">

  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>

  <cbc:ID>${escapeXml(invoice.number)}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:DueDate>${dueDate}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${escapeXml(currency)}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>Eventflow Subscription</cbc:BuyerReference>

  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="0208">${
    escapeXml(sellerEndpointId)
  }</cbc:EndpointID>

      <cac:PartyName>
        <cbc:Name>${escapeXml(seller.name)}</cbc:Name>
      </cac:PartyName>

      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(seller.street)}</cbc:StreetName>
        <cbc:CityName>${escapeXml(seller.city)}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(seller.postalCode)}</cbc:PostalZone>

        <cac:Country>
          <cbc:IdentificationCode>${
    escapeXml(seller.country)
  }</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>

      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(sellerVat)}</cbc:CompanyID>

        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>

      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(seller.name)}</cbc:RegistrationName>
        <cbc:CompanyID>${escapeXml(sellerVat)}</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:EndpointID schemeID="0208">${
    escapeXml(buyerEndpointId)
  }</cbc:EndpointID>

      <cac:PartyName>
        <cbc:Name>${escapeXml(buyerName)}</cbc:Name>
      </cac:PartyName>

      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(buyerStreet)}</cbc:StreetName>
        ${
    buyerStreet2
      ? `<cbc:AdditionalStreetName>${
        escapeXml(buyerStreet2)
      }</cbc:AdditionalStreetName>`
      : ""
  }
        <cbc:CityName>${escapeXml(buyerCity)}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(buyerPostalCode)}</cbc:PostalZone>

        <cac:Country>
          <cbc:IdentificationCode>${
    escapeXml(buyerCountry)
  }</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>

      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(buyerVat)}</cbc:CompanyID>

        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>

      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(buyerName)}</cbc:RegistrationName>
        <cbc:CompanyID>${escapeXml(buyerVat)}</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>

  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${escapeXml(currency)}">${vat}</cbc:TaxAmount>

    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${
    escapeXml(currency)
  }">${subtotal}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${escapeXml(currency)}">${vat}</cbc:TaxAmount>

      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${escapeXml(vatPercent)}</cbc:Percent>

        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>

  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${
    escapeXml(currency)
  }">${subtotal}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${
    escapeXml(currency)
  }">${subtotal}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${
    escapeXml(currency)
  }">${total}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${
    escapeXml(currency)
  }">${total}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${
    escapeXml(currency)
  }">${subtotal}</cbc:LineExtensionAmount>

    <cac:Item>
      <cbc:Name>Abonnement Eventflow</cbc:Name>

      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${escapeXml(vatPercent)}</cbc:Percent>

        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>

    <cac:Price>
      <cbc:PriceAmount currencyID="${
    escapeXml(currency)
  }">${subtotal}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>

</Invoice>`;
}

async function updatePeppolStatus(
  admin: SupabaseClient,
  invoiceId: string,
  input: {
    status: string;

    providerMessageId?: string | null;

    errorMessage?: string | null;
  },
  logger: Logger,
): Promise<void> {
  const {
    error,
  } = await admin.rpc(
    "rpc_update_invoice_peppol_status",
    {
      p_input: {
        invoice_id: invoiceId,

        status: input.status,

        provider_message_id: input.providerMessageId ??
          null,

        error_message: input.errorMessage ??
          null,
      },
    },
  );

  if (
    error
  ) {
    logger.error(
      "peppol_status_update_failed",
      {
        invoiceId,

        status: input.status,

        message: error.message,
      },
    );

    throw new Error(
      "PEPPOL_STATUS_UPDATE_FAILED",
    );
  }

  logger.info(
    "peppol_status_updated",
    {
      invoiceId,

      status: input.status,
    },
  );
}

export async function sendInvoiceToBillit(
  admin: SupabaseClient,
  invoiceId: string,
  options: { debug?: boolean; dryRun?: boolean } = {},
) {
  const logger = createConsoleLogger("billit");
  const { debug = false, dryRun = false } = options;
  assertBillitEnabled();
  const billitApiKey = Deno.env.get(
    "BILLIT_API_KEY",
  );

  const billitPartyId = Deno.env.get(
    "BILLIT_PARTY_ID",
  );

  const billitBaseUrl = Deno.env.get(
    "BILLIT_BASE_URL",
  ) ??
    "https://api.billit.be";

  const billitEndpoint = `${billitBaseUrl}/v1/peppol/sendxml`;

  const seller: SellerConfig = {
    name: clean(
      Deno.env.get(
        "BILLIT_SELLER_NAME",
      ),
      "Eventflow",
    ),

    vat: clean(
      Deno.env.get(
        "BILLIT_SELLER_VAT",
      ),
    ),

    country: clean(
      Deno.env.get(
        "BILLIT_SELLER_COUNTRY",
      ),
      "BE",
    ),

    endpointId: clean(
      Deno.env.get(
        "BILLIT_SELLER_ENDPOINT_ID",
      ),
    ),

    street: clean(
      Deno.env.get(
        "BILLIT_SELLER_STREET",
      ),
    ),

    city: clean(
      Deno.env.get(
        "BILLIT_SELLER_CITY",
      ),
    ),

    postalCode: clean(
      Deno.env.get(
        "BILLIT_SELLER_POSTAL_CODE",
      ),
    ),
  };

  logger.info(
    "runtime_config_resolved",
    {
      invoiceId,

      billitBaseUrl,

      hasBillitApiKey: Boolean(
        billitApiKey,
      ),

      hasBillitPartyId: Boolean(
        billitPartyId,
      ),

      hasSellerVat: Boolean(
        seller.vat,
      ),

      hasSellerEndpointId: Boolean(
        seller.endpointId,
      ),
    },
  );

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
              number,
              currency,
              subtotal_cents,
              vat_cents,
              total_cents,
              vat_rate,
              issued_at,
              paid_at,
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
        ok: false,

        error: "invoice_query_error",
      },
      500,
    );
  }

  if (
    !invoice
  ) {
    logger.warn(
      "invoice_not_found",
      {
        invoiceId,
      },
    );

    return json(
      {
        ok: false,

        error: "invoice_not_found",

        invoice_id: invoiceId,
      },
      404,
    );
  }

  logger.info(
    "invoice_loaded",
    {
      invoiceId: invoice.id,

      invoiceNumber: invoice.number,

      subtotalCents: invoice.subtotal_cents,

      vatCents: invoice.vat_cents,

      totalCents: invoice.total_cents,

      vatRate: invoice.vat_rate,

      hasPdf: Boolean(
        invoice.pdf_path,
      ),
    },
  );

  const {
    data: peppolRow,

    error: peppolError,
  } = await admin
    .from(
      "invoice_peppol",
    )
    .select(
      `
              status,
              attempt_count,
              error_message,
              provider_message_id,
              sent_at
            `,
    )
    .eq(
      "invoice_id",
      invoiceId,
    )
    .eq(
      "provider",
      "billit",
    )
    .maybeSingle();

  if (
    peppolError
  ) {
    logger.error(
      "peppol_row_load_failed",
      {
        invoiceId,

        message: peppolError.message,
      },
    );

    return json(
      {
        ok: false,

        error: "peppol_query_error",
      },
      500,
    );
  }

  logger.info(
    "peppol_state_loaded",
    {
      invoiceId,

      status: peppolRow?.status ??
        null,

      attemptCount: peppolRow?.attempt_count ??
        0,

      hasProviderMessageId: Boolean(
        peppolRow?.provider_message_id,
      ),
    },
  );

  if (
    peppolRow?.status ===
      "sent" &&
    !debug &&
    !dryRun
  ) {
    logger.info(
      "already_sent_reused",
      {
        invoiceId,

        providerMessageId: peppolRow.provider_message_id ??
          null,
      },
    );

    return json(
      {
        ok: true,

        reused: true,

        reason: "already_sent",

        providerMessageId: peppolRow.provider_message_id,

        sentAt: peppolRow.sent_at,
      },
      200,
    );
  }

  const snapshot = invoice.billing_snapshot as {
    billing?: Record<
      string,
      unknown
    >;
  } | null;

  const billing = snapshot?.billing ??
    {};

  const buyerPeppolDataOk = hasBuyerPeppolData(
    billing,
  );

  const ublXml = buildUblInvoice(
    invoice,
    seller,
  );

  logger.info(
    "ubl_built",
    {
      invoiceId,

      invoiceNumber: invoice.number,

      buyerPeppolDataOk,

      xmlLength: ublXml.length,
    },
  );

  if (
    debug ||
    dryRun
  ) {
    logger.info(
      "dry_run_completed",
      {
        invoiceId,

        debug,

        dryRun,
      },
    );

    return json(
      {
        ok: true,

        debug: true,

        dryRun: true,

        invoice: {
          id: invoice.id,

          number: invoice.number,

          currency: invoice.currency,

          subtotal_cents: invoice.subtotal_cents,

          vat_cents: invoice.vat_cents,

          total_cents: invoice.total_cents,

          vat_rate: invoice.vat_rate,

          issued_at: invoice.issued_at,

          paid_at: invoice.paid_at,

          pdf_path: invoice.pdf_path,
        },

        peppol: peppolRow,

        billit: {
          endpoint: billitEndpoint,

          baseUrl: billitBaseUrl,

          hasApiKey: Boolean(
            billitApiKey,
          ),

          hasPartyId: Boolean(
            billitPartyId,
          ),

          partyId: billitPartyId ??
            null,
        },

        seller,

        buyer: billing,

        buyerPeppolDataOk,

        ublPreview: safeStr(
          ublXml,
          4000,
        ),
      },
      200,
    );
  }

  await updatePeppolStatus(
    admin,
    invoiceId,
    {
      status: "sending",

      errorMessage: null,
    },
    logger,
  );

  if (
    !billitApiKey ||
    !billitPartyId
  ) {
    logger.warn(
      "billit_not_configured",
      {
        invoiceId,

        hasApiKey: Boolean(
          billitApiKey,
        ),

        hasPartyId: Boolean(
          billitPartyId,
        ),
      },
    );

    await updatePeppolStatus(
      admin,
      invoiceId,
      {
        status: "skipped",

        errorMessage:
          "Billit not configured (missing BILLIT_API_KEY or BILLIT_PARTY_ID)",
      },
      logger,
    );

    return json(
      {
        ok: true,

        skipped: true,

        reason: "billit_not_configured",
      },
      200,
    );
  }

  if (
    !buyerPeppolDataOk
  ) {
    logger.info(
      "buyer_peppol_data_missing",
      {
        invoiceId,

        hasLegalName: Boolean(
          clean(
            billing.legalName,
          ),
        ),

        hasCountryCode: Boolean(
          clean(
            billing.countryCode,
          ),
        ),

        hasVatCountryCode: Boolean(
          clean(
            billing.vatCountryCode,
          ),
        ),

        hasVatNumber: Boolean(
          clean(
            billing.vatNumber,
          ),
        ),
      },
    );

    await updatePeppolStatus(
      admin,
      invoiceId,
      {
        status: "skipped",

        errorMessage:
          "Peppol not applicable (missing buyer legal/VAT/address data)",
      },
      logger,
    );

    return json(
      {
        ok: true,

        skipped: true,

        reason: "missing_buyer_peppol_data",
      },
      200,
    );
  }

  if (
    !invoice.pdf_path
  ) {
    logger.info(
      "pdf_generation_requested",
      {
        invoiceId,
      },
    );

    await runInBackground(
      generateInvoicePdf(admin, invoiceId)
        .then(
          (
            result,
          ) => {
            if (
              result.error
            ) {
              logger.error(
                "pdf_generation_invoke_failed",
                {
                  invoiceId,

                  message: result.error.message,
                },
              );

              return;
            }

            logger.info(
              "pdf_generation_invoked",
              {
                invoiceId,
              },
            );
          },
        )
        .catch(
          (
            error,
          ) => {
            logger.error(
              "pdf_generation_invoke_crashed",
              {
                invoiceId,

                message: error instanceof
                    Error
                  ? error.message
                  : String(
                    error,
                  ),
              },
            );
          },
        ),
    );
  }

  logger.info(
    "billit_send_start",
    {
      invoiceId,

      invoiceNumber: invoice.number,

      endpoint: billitEndpoint,

      partyId: billitPartyId,
    },
  );

  const response = await fetch(
    billitEndpoint,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",

        Accept: "application/json",

        ApiKey: billitApiKey,

        PartyID: billitPartyId,
      },

      body: JSON.stringify(
        {
          XML: ublXml,
        },
      ),
    },
  );

  const responseText = await response
    .text()
    .catch(
      () => "",
    );

  logger.info(
    "billit_response_received",
    {
      invoiceId,

      status: response.status,

      statusText: response.statusText,

      responseBody: safeStr(
        responseText,
        1000,
      ),
    },
  );

  if (
    !response.ok
  ) {
    const customerDoesNotSupportPeppol = responseText.includes(
      "TheCustomerDoesNotSupportPeppolForType",
    );

    if (
      customerDoesNotSupportPeppol
    ) {
      logger.info(
        "customer_not_on_peppol",
        {
          invoiceId,

          billitStatus: response.status,
        },
      );

      await updatePeppolStatus(
        admin,
        invoiceId,
        {
          status: "skipped",

          errorMessage: safeStr(
            responseText,
            500,
          ),
        },
        logger,
      );

      return json(
        {
          ok: true,

          skipped: true,

          reason: "customer_does_not_support_peppol_invoice",

          billitStatus: response.status,

          body: safeStr(
            responseText,
            1000,
          ),
        },
        200,
      );
    }

    logger.error(
      "billit_send_failed",
      {
        invoiceId,

        status: response.status,

        statusText: response.statusText,

        body: safeStr(
          responseText,
          1000,
        ),
      },
    );

    await updatePeppolStatus(
      admin,
      invoiceId,
      {
        status: "failed",

        errorMessage: safeStr(
          responseText ||
            `HTTP ${response.status}`,
          500,
        ),
      },
      logger,
    );

    return json(
      {
        ok: false,

        error: "billit_send_failed",

        status: response.status,

        statusText: response.statusText,

        body: safeStr(
          responseText,
          1000,
        ),
      },
      502,
    );
  }

  let payload: Record<
    string,
    unknown
  > = {};

  try {
    payload = responseText
      ? JSON.parse(
        responseText,
      )
      : {};
  } catch {
    payload = {
      raw: responseText,
    };
  }

  const providerMessageId = clean(
    payload.message_id ??
      payload.messageId ??
      payload.id,
  ) ||
    null;

  await updatePeppolStatus(
    admin,
    invoiceId,
    {
      status: "sent",

      providerMessageId,

      errorMessage: null,
    },
    logger,
  );

  logger.info(
    "completed",
    {
      invoiceId,

      invoiceNumber: invoice.number,

      providerMessageId,
    },
  );

  return json(
    {
      ok: true,

      messageId: providerMessageId,

      payload,
    },
    200,
  );
}
