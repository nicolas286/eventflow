import { useEffect, useMemo, useRef, useState } from "react";
import { EdgeRequestError, humanEdgeRequestMessage } from "@errors/edgeRequestError";
import { invoicePdfRepo } from "../data/makeInvoicePdfUrlRepo";
import { Button, Badge, Card, CardBody, CardHeader } from "@ui/components";
import { useMakeInvoiceList } from "../hooks/useMakeInvoiceList";
import { supabase } from "@gateways/supabase/supabaseClient";
import type { InvoiceHistoryItem } from "@contracts/invoice-history";

function fmtMoneyCents(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return (v / 100).toLocaleString("fr-BE", {
    style: "currency",
    currency: "EUR",
  });
}

function fmtDateShort(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("fr-BE");
  } catch {
    return String(d);
  }
}

export function InvoicesTab({ orgId }: { orgId: string }) {
  const invoices = useMakeInvoiceList({ supabase });
  const [pdfError, setPdfError] = useState<string | null>(null);
  const pdfRetryAt = useRef(0);

  const pdfRepo = useMemo(() => invoicePdfRepo(supabase), []);

  useEffect(() => {
    invoices.fetchFirst({ orgId, limit: 25 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function onDownloadPdf(inv: InvoiceHistoryItem) {
    if (Date.now() < pdfRetryAt.current) return;
    setPdfError(null);
    try {
      const { url } = await pdfRepo.getPdfUrl({
        invoiceId: inv.id,
      });

      window.open(url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      if (cause instanceof EdgeRequestError) {
        pdfRetryAt.current = Date.now() + cause.retryAfterSeconds * 1000;
      }
      setPdfError(cause instanceof EdgeRequestError
        ? humanEdgeRequestMessage(cause)
        : "Impossible de télécharger la facture. Réessayez dans quelques instants.");
    }
  }

  const isEmpty = invoices.items.length === 0 && !invoices.loading;

  return (
    <Card>
      <CardHeader
        title="Mes factures"
        subtitle="Historique des factures et téléchargements PDF."
      />
      <CardBody>
        {pdfError && (
          <div className="adminSub__alert adminSub__alert--error" role="alert">
            {pdfError}
          </div>
        )}
        {invoices.error && (
          <div className="adminSub__alert adminSub__alert--error">
            {invoices.error}
          </div>
        )}

        {/* Wrapper unique pour forcer le comportement CSS */}
        <div className="invWrap" data-invoices-view="wrap">
          {/* ============ MOBILE LIST (hidden by default, shown on mobile) ============ */}
          <div className="invMobileList" data-invoices-view="mobile">
            {isEmpty ? (
              <div className="invEmpty">Aucune facture pour l’instant.</div>
            ) : (
              invoices.items.map((inv) => (
                <div key={inv.id} className="invMobileCard">
                  <div className="invMobileTop">
                    <div className="invMobileLeft">
                      <div className="invMobileTitle">
                        {inv.number ? `Facture ${inv.number}` : "Facture"}
                      </div>
                      <div className="invMobileMeta">
                        {fmtDateShort(inv.issuedAt)}
                      </div>
                    </div>
                    <div className="invMobileRight">
                      <Badge>{inv.status ?? "—"}</Badge>
                    </div>
                  </div>

                  <div className="invMobileGrid">
                    <div className="invMobileRow">
                      <div className="invMobileLabel">Montant</div>
                      <div className="invMobileValue">
                        {fmtMoneyCents(inv.totalCents)}
                      </div>
                    </div>
                    <div className="invMobileRow">
                      <div className="invMobileLabel">Numéro</div>
                      <div className="invMobileValue">{inv.number ?? "—"}</div>
                    </div>
                    <div className="invMobileRow">
                      <div className="invMobileLabel">Date</div>
                      <div className="invMobileValue">
                        {fmtDateShort(inv.issuedAt)}
                      </div>
                    </div>
                    {inv.status === "issued" ? (
                      <>
                        <div className="invMobileRow">
                          <div className="invMobileLabel">À payer avant</div>
                          <div className="invMobileValue">
                            {fmtDateShort(inv.dueAt)}
                          </div>
                        </div>
                        <div className="invMobileRow">
                          <div className="invMobileLabel">Communication</div>
                          <div className="invMobileValue">
                            {inv.paymentReference ?? inv.number}
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>

                  <div className="invMobileActions">
                    <Button
                      variant="secondary"
                      onClick={() => onDownloadPdf(inv)}
                    >
                      Télécharger PDF
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ============ DESKTOP TABLE (shown by default, hidden on mobile) ============ */}
          <div className="invDesktopTable" data-invoices-view="desktop">
            <table className="invTable">
              <thead>
                <tr className="invHeadRow">
                  <th className="invTh">Date</th>
                  <th className="invTh">Numéro</th>
                  <th className="invTh">Montant</th>
                  <th className="invTh">Statut</th>
                  <th className="invTh invThRight" />
                </tr>
              </thead>

              <tbody>
                {isEmpty ? (
                  <tr>
                    <td colSpan={5} className="invEmptyRow">
                      Aucune facture pour l’instant.
                    </td>
                  </tr>
                ) : (
                  invoices.items.map((inv) => (
                    <tr key={inv.id} className="invTr">
                      <td className="invTd">
                        {fmtDateShort(inv.issuedAt)}
                        {inv.status === "issued" ? (
                          <div>Échéance : {fmtDateShort(inv.dueAt)}</div>
                        ) : null}
                      </td>
                      <td className="invTd invTdStrong">{inv.number ?? "—"}</td>
                      <td className="invTd">{fmtMoneyCents(inv.totalCents)}</td>
                      <td className="invTd">
                        <Badge>{inv.status ?? "—"}</Badge>
                      </td>
                      <td className="invTd invTdRight">
                        <Button
                          variant="secondary"
                          onClick={() => onDownloadPdf(inv)}
                        >
                          Télécharger PDF
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="invFooterActions">
          <Button
            variant="secondary"
            disabled={invoices.loading}
            onClick={() => invoices.fetchFirst({ orgId })}
          >
            Rafraîchir
          </Button>

          <Button
            disabled={invoices.loading || !invoices.hasMore}
            onClick={() => invoices.fetchMore({ orgId })}
          >
            {invoices.loading
              ? "Chargement…"
              : invoices.hasMore
                ? "Charger plus"
                : "Tout est chargé"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
