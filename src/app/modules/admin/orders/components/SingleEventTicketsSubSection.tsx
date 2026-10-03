import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@gateways/supabase/supabaseClient";

import { Button, FilterBar } from "@ui/components";
import { useAdminSingleEventTicketsData } from "../../singleEvent/hooks/useEventTickets";
import { useSearchEventAdminTicketsData } from "../hooks/useSearchEventTicketsView";

import type { AdminEventTicketRow as AdminEventTicket } from "../../singleEvent/schemas/admin.eventTickets.schema";
import { useMarkTicketCheckedIn } from "../hooks/useMarkTicketCheckedIn";
import { useMarkTicketCheckedInByQr } from "../hooks/useMarkTicketCheckedInByQr";
import {
  TicketQrScannerFullscreen,
  type TicketQrScanOutcome,
} from "../components/TicketQrScannerFullscreen";

import "./attendees.css";
import { MessageBox } from "@shared/ui/components/message/MessageBox";

type FilterMode = "all" | "used" | "unused";

const PAGE_SIZE = 25;


export function SingleEventTicketsSubSection(props: {
  eventId: string;
  eventTitle: string;
  onChanged?: () => Promise<void>;
  autoOpenScanner?: boolean;
  onScannerAutoOpened?: () => void;
}) {
  const {
    eventId,
    onChanged,
    autoOpenScanner,
    onScannerAutoOpened,
  } = props;

  const { session } = useAuth();
  const sessionScope = getSessionScope(session);
  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [page, setPage] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(() => Boolean(autoOpenScanner));
  const autoOpenConsumedRef = useRef(false);

  useEffect(() => {
    if (!autoOpenScanner) return;
    if (autoOpenConsumedRef.current) return;

    autoOpenConsumedRef.current = true;
    onScannerAutoOpened?.();
  }, [autoOpenScanner, onScannerAutoOpened]);

  const trimmedQuery = query.trim();
  const isSearchMode = trimmedQuery.length > 0;
  const offset = page * PAGE_SIZE;

  const normalView = useAdminSingleEventTicketsData({
    supabase,
    eventId,
    enabled: Boolean(eventId) && !isSearchMode,
    limit: PAGE_SIZE,
    offset,
  });

  const searchView = useSearchEventAdminTicketsData({
    supabase,
    eventId,
    query: trimmedQuery,
    enabled: Boolean(eventId) && isSearchMode,
    limit: PAGE_SIZE,
    offset,
  });

  const activeData = isSearchMode ? searchView.data : normalView.data;
  const activeLoading = isSearchMode ? searchView.loading : normalView.loading;
  const activeError = isSearchMode ? searchView.error : normalView.error;
  const activeRefetch = isSearchMode ? searchView.refetch : normalView.refetch;

  const rawTickets = useMemo(() => activeData?.tickets?.rows ?? [], [activeData]);
  const totalTickets = activeData?.tickets?.total ?? 0;

  const markTicket = useMarkTicketCheckedIn({ supabase, eventId });
  const markTicketByQr = useMarkTicketCheckedInByQr({ supabase, eventId });

  const ticketsByQrToken = useMemo(() => {
    const map = new Map<string, AdminEventTicket>();

    for (const ticket of rawTickets) {
      map.set(ticket.qrToken.trim(), ticket);
    }

    return map;
  }, [rawTickets]);

  const ticketsByQrTokenRef = useRef(ticketsByQrToken);

  useEffect(() => {
    ticketsByQrTokenRef.current = ticketsByQrToken;
  }, [ticketsByQrToken]);

  const handleScanToken = useCallback(
    async (qrTokenRaw: string): Promise<TicketQrScanOutcome> => {
      const qrToken = qrTokenRaw.trim();

      try {
        const result = await markTicketByQr.markTicketCheckedInByQr(qrToken, eventId);
        const localTicket = ticketsByQrTokenRef.current.get(qrToken);

        const ticket = {
          ticketId: result.ticketId,
          orderId: result.orderId,
          ticketIndex: result.ticketIndex,
          qrToken: result.qrToken,
          status: result.status,
          checkedInAt: result.checkedInAt,
          checkedInBy: result.checkedInBy ?? undefined,
          productNameSnapshot: localTicket?.productNameSnapshot,
        };

        void activeRefetch();

        return result.outcome === "already_checked"
          ? { kind: "alreadyChecked", ticket }
          : { kind: "validated", ticket };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erreur inconnue";
        return { kind: "error", message };
      }
    },
    [eventId, markTicketByQr, activeRefetch],
  );

  const displayedTickets = useMemo(() => {
    let rows = rawTickets;

    if (filterMode === "used") {
      rows = rows.filter((t) => Boolean(t.checkedInAt));
    }

    if (filterMode === "unused") {
      rows = rows.filter((t) => !t.checkedInAt);
    }

    return [...rows].sort((a, b) => {
      const aUsed = Boolean(a.checkedInAt);
      const bUsed = Boolean(b.checkedInAt);

      if (aUsed !== bUsed) {
        return aUsed ? 1 : -1;
      }

      return 0;
    });
  }, [rawTickets, filterMode]);

  const totalPages = Math.max(1, Math.ceil(totalTickets / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);

  const canGoPrev = safePage > 0;
  const canGoNext = safePage < totalPages - 1;

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setPage(0);
  }, []);

  const handleFilterChange = useCallback((value: string) => {
    setFilterMode(value as FilterMode);
    setPage(0);
  }, []);

  return (
    <div className="adminTicketsSection">
      <div className="adminParticipantsHeader">
        <div>
          <h3 className="adminParticipantsTitle">Tickets</h3>
          <div className="adminParticipantsHint">
            {isSearchMode
              ? `${displayedTickets.length} billet(s) trouvé(s) sur cette page — ${totalTickets} au total`
              : filterMode !== "all"
                ? `${displayedTickets.length} billet(s) sur cette page — ${totalTickets} au total`
                : `${totalTickets} billet(s) au total`}
          </div>
        </div>

        <div className="adminParticipantsHeaderRight">
          <Button variant="secondary" onClick={() => setScannerOpen(true)}>
            Scanner QR
          </Button>

          <Button variant="secondary" onClick={() => void activeRefetch()}>
            Rafraîchir
          </Button>
        </div>
      </div>

      <FilterBar
        query={query}
        onQueryChange={handleQueryChange}
        selectValue={filterMode}
        onSelectChange={handleFilterChange}
        placeholder="Rechercher un billet sur tout l’événement…"
        selectOptions={[
          { value: "all", label: "Tous" },
          { value: "unused", label: "Non utilisés" },
          { value: "used", label: "Utilisés" },
        ]}
      />

      {markTicket.error ? <MessageBox variant="error">{markTicket.error}</MessageBox> : null}
      {markTicketByQr.error ? <MessageBox variant="error">{markTicketByQr.error}</MessageBox> : null}

      {totalTickets > 0 ? (
        <div className="adminListPager">
          <Button
            variant="secondary"
            disabled={!canGoPrev || activeLoading}
            onClick={() => setPage((prev) => Math.max(0, prev - 1))}
          >
            Précédent
          </Button>

          <div className="adminListPager__label">
            Page {safePage + 1} / {totalPages}
            {displayedTickets.length > 0 ? ` — ${displayedTickets.length} ticket(s) affiché(s)` : ""}
          </div>

          <Button
            variant="secondary"
            disabled={!canGoNext || activeLoading}
            onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
          >
            Suivant
          </Button>
        </div>
      ) : null}

      {activeLoading ? (
        <div className="adminEventEmpty">
          {isSearchMode ? "Recherche des billets…" : "Chargement des billets…"}
        </div>
      ) : activeError ? (
        <div className="adminEventEmpty">{activeError}</div>
      ) : displayedTickets.length === 0 ? (
        <div className="adminEventEmpty">
          {isSearchMode
            ? "Aucun résultat sur l’ensemble de l’événement."
            : filterMode !== "all"
              ? "Aucun résultat avec ces filtres sur cette page."
              : "Aucun billet pour le moment."}
        </div>
      ) : (
        <div className="adminTicketsList">
          {displayedTickets.map((ticket: AdminEventTicket) => {
            const isUsed = Boolean(ticket.checkedInAt);
            const isInvalid = ticket.status === "invalid" || ticket.status === "cancelled";

            return (
              <div key={ticket.id} className="adminTicketRow">
                <div className="adminTicketRowMain">
                  <div className="adminTicketRowTitle">{ticket.productNameSnapshot}</div>

                  <div className="adminTicketRowMeta">
                    #{ticket.ticketIndex} • réf {ticket.reference}
                    {ticket.createsAttendees ? " • nominatif" : " • non nominatif"}
                  </div>

                  {ticket.attendeeSummaryLines?.length > 0 ? (
                    <div className="adminTicketRowAttendee">
                      {ticket.attendeeSummaryLines.join(" • ")}
                    </div>
                  ) : null}

                  {ticket.buyerEmail ? (
                    <div className="adminTicketRowBuyer">Acheteur : {ticket.buyerEmail}</div>
                  ) : null}
                </div>

                <div className="adminTicketRowRight">
                  <div className="adminTicketRowActions">
                    {isInvalid ? (
                      <span className="adminTicketStatus invalid">Invalide</span>
                    ) : isUsed ? (
                      <span className="adminTicketStatus used">Utilisé</span>
                    ) : (
                      <span className="adminTicketStatus ready">Non utilisé</span>
                    )}

                    <Button
                      variant="secondary"
                      disabled={isUsed || isInvalid || markTicket.loading}
                      onClick={async () => {
                        try {
                          await markTicket.markTicketCheckedIn(ticket.id, eventId);
                          await activeRefetch();
                          if (markTicket.isCurrentScope()) await onChanged?.();
                        } catch {
                          // Current failures are displayed by the scoped mutation hook.
                        }
                      }}
                    >
                      Marquer comme utilisé
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TicketQrScannerFullscreen
        key={`${sessionScope}:${eventId}`}
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanToken={handleScanToken}
      />
    </div>
  );
}