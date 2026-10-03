import type { EventProduct, EventProducts } from "@shared/models/db/db.eventProducts.schema";
import type { CreateEventProductInput } from "@app/modules/admin/products/schemas/admin.createEventProduct.schema";
import type { UpdateEventProductPatch } from "@app/modules/admin/products/data/updateEventProductRepo";

import { Button, EditorShell, FilterBar } from "@ui/components";
import { TrashIcon } from "@ui/components/icon/Icons";
import { useMediaQuery } from "@helpers/ui";
import { formatMoney } from "@helpers/normalize";
import { nonNegInt, posInt } from "@helpers/logic";

import { useEventTicketsEditor, type TicketDraft } from "../../hooks/useEventTicketsEditor";
import { EventTicketEditorNode } from "./EventTicketEditorNode";
import { FlexPanel } from "@ui/components/panels/FlexPanel";
import { useToast } from "@shared/ui/components/toast/useToast";

type Props = {
  orgId: string;
  event: { id: string } | null;
  products: EventProducts;

  onCreate: (input: CreateEventProductInput) => Promise<void>;
  onUpdate: (input: { productId: string; patch: UpdateEventProductPatch }) => Promise<void>;
  updateLoading?: boolean;
  createLoading?: boolean;
  createError?: string | null;

  onRemove?: (productId: string) => Promise<void>;
  deleteLoading?: boolean;
  deleteError?: string | null;

  onChanged?: () => void;
  isCurrentScope: () => boolean;
};

export function EventTicketsPanel(props: Props) {
  const {
    event,
    products,
    onCreate,
    onUpdate,
    onRemove,
    onChanged,
    isCurrentScope,
    createLoading = false,
    updateLoading = false,
    deleteLoading = false,
  } = props;

  const isMobile = useMediaQuery("(max-width: 1050px)");
  const { showToast } = useToast();

  const {
    editing,
    creating,
    isSaving,
    moveFx,
    query,
    setQuery,
    sorted,
    filtered,
    isFiltering,
    closingKey,
    isClosing,
    setEditing,
    openCreate,
    openEdit,
    closeEditor,
    saveEditor,
    togglePersisted,
    movePersisted,
    removePersisted,
    getSoldQty,
    formatStockLine,
  } = useEventTicketsEditor({
    eventId: event?.id ?? null,
    products,
    onCreate,
    onUpdate,
    onRemove,
    onChanged,
    isCurrentScope,
    createLoading,
    updateLoading,
    deleteLoading,

    onActionSuccess: (kind) => {
    const config: Record<
      string,
      {
        title: string;
        description: string;
      }
    > = {
      created: {
        title: "Ticket créé",
        description: "Le ticket a été ajouté à l’événement.",
      },

      updated: {
        title: "Ticket modifié",
        description: "Les informations du ticket ont été mises à jour.",
      },

      deleted: {
        title: "Ticket supprimé",
        description: "Le ticket a été supprimé de l’événement.",
      },

      activated: {
        title: "Ticket activé",
        description: "Le ticket est maintenant disponible à la réservation.",
      },

      deactivated: {
        title: "Ticket désactivé",
        description: "Le ticket n’est plus disponible à la réservation.",
      },

      reordered: {
        title: "Ticket déplacé",
        description: "L’ordre des tickets a été mis à jour.",
      },
    };

    const toast = config[kind];

    showToast({
      title: toast?.title ?? "Opération réussie",
      description: toast?.description,
      variant: "success",
      duration: 3000,
    });
  },

    onActionError: (message) => {
      showToast({
        title: "Opération impossible",
        description: message,
        variant: "error",
        duration: 6000,
      });
    },
  });

  const isOpen = Boolean(editing);
  const editingId = editing?.id ?? null;
  const showCreateInline = (isOpen && creating) || (isClosing && closingKey === "create");

  const editorNode = (
    <EventTicketEditorNode
      editing={editing}
      creating={creating}
      setEditing={setEditing}
      isSaving={isSaving}
      nonNegInt={nonNegInt}
      posInt={posInt}
      onSave={saveEditor}
      onClose={closeEditor}
    />
  );

  function renderTicketCard(t: TicketDraft, idx: number) {
    const active = Boolean(t.isActive ?? true);

    const p =
      t.id && Array.isArray(products)
        ? products.find((x: EventProduct) => String(x?.id) === String(t.id))
        : null;

    const currency = "EUR";
    const sold = getSoldQty(p);
    const stockLine = formatStockLine(sold, p?.stockQty ?? t.stockQty);

    const isFxA = moveFx?.aId === t.clientId;
    const isFxB = moveFx?.bId === t.clientId;

    const fxClass =
      moveFx && isFxA
        ? moveFx.dir === -1
          ? "isMoveUp"
          : "isMoveDown"
        : moveFx && isFxB
          ? moveFx.dir === -1
            ? "isMoveDown"
            : "isMoveUp"
          : "";

    return (
      <div
        key={t.clientId}
        className={[
          active ? "adminTicketCard" : "adminTicketCard isInactive",
          "adminReorderCard",
          fxClass,
        ].join(" ")}
        data-movefx={moveFx?.nonce ?? ""}
      >
        <div className="adminTicketTop">
          <div className="adminTicketTitle">{t.name || "—"}</div>
          <div className={active ? "adminTicketPill" : "adminTicketPill isOff"}>
            {active ? "Actif" : "Inactif"}
          </div>
        </div>

        <div className="adminTicketMeta">
          <span className="adminTicketStrong">
            {formatMoney(t.priceCents ?? 0, currency)}
          </span>
          <span>•</span>
          <span>Stock : {stockLine}</span>
        </div>

        <div className="adminTicketMeta">
          {t.createsAttendees ? (
            <span>
              Ce billet crée <strong>{t.attendeesPerUnit ?? 1}</strong> participant
              {(t.attendeesPerUnit ?? 1) > 1 ? "s" : ""} qui devra
              {(t.attendeesPerUnit ?? 1) > 1 ? "ont" : ""} remplir le formulaire
            </span>
          ) : (
            <span>
              Ce billet ne crée <strong>aucun participant</strong>
            </span>
          )}
        </div>

        <div className="adminTicketStats">
          <div className="adminTicketStat">
            <div className="adminTicketStatLabel">Vendus</div>
            <div className="adminTicketStatValue">{sold}</div>
          </div>
        </div>

        {t.description ? <div className="adminTicketDesc">{t.description}</div> : null}

        <div className="adminTicketActions">
          <Button variant="secondary" onClick={() => openEdit(t)} disabled={isSaving}>
            Modifier
          </Button>

          <Button
            variant="secondary"
            onClick={() => togglePersisted(t.clientId, { isActive: !active })}
            disabled={isSaving}
          >
            {active ? "Désactiver" : "Activer"}
          </Button>

          <Button
            className={[
              "adminReorderBtn",
              isFxA && moveFx?.dir === -1 ? "isBumpUp" : "",
            ].join(" ")}
            onClick={() => movePersisted(t.clientId, -1)}
            disabled={isSaving || isFiltering || idx === 0}
            aria-label={isFiltering ? "Réordonnancement désactivé pendant une recherche" : "Monter"}
            variant="secondary"
          >
            ↑
          </Button>

          <Button
            className={[
              "adminReorderBtn",
              isFxA && moveFx?.dir === 1 ? "isBumpDown" : "",
            ].join(" ")}
            onClick={() => movePersisted(t.clientId, 1)}
            disabled={isSaving || isFiltering || idx === sorted.length - 1}
            title={
              isFiltering
                ? "Réordonnancement désactivé pendant une recherche. Efface le filtre pour changer l’ordre."
                : undefined
            }
            aria-label={isFiltering ? "Réordonnancement désactivé pendant une recherche" : "Descendre"}
            variant="secondary"
          >
            ↓
          </Button>

          <Button
            variant="danger"
            onClick={() => removePersisted(t.clientId)}
            disabled={isSaving || (!onRemove && Boolean(t.id))}
            className="deleteFormFieldButton"
          >
            <TrashIcon />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <FlexPanel
      title="Tickets"
      subtitle="Créez et modifiez vos tickets, ajustez leur ordre ou leur disponibilité."
      state="default"
      actions={
        <Button onClick={openCreate} disabled={!event?.id || isSaving} variant="secondary">
          Nouveau ticket
        </Button>
      }
    >
      <FilterBar query={query} onQueryChange={setQuery} placeholder="Rechercher un ticket…" />

      {isMobile ? (
        <div className={isOpen || isClosing ? "adminTicketsInlineShell isEditorOpen" : "adminTicketsInlineShell"}>
          {showCreateInline ? (
            <div
              className={[
                "adminTicketsInlineEditor",
                "isCreate",
                isClosing && closingKey === "create" ? "isClosing" : "isOpen",
              ].join(" ")}
            >
              {editorNode}
            </div>
          ) : null}

          <div className="adminTicketsList">
            {sorted.length === 0 ? (
              <div className="adminEventEmpty">Aucun ticket. Clique sur “Nouveau ticket”.</div>
            ) : filtered.length === 0 ? (
              <div className="adminEventEmpty">Aucun ticket ne correspond à “{query.trim()}”.</div>
            ) : (
              filtered.map((t) => {
                const idx = sorted.findIndex((x) => x.clientId === t.clientId);

                const showEditInline =
                  (isOpen && !creating && editingId === t.clientId) ||
                  (isClosing && closingKey === t.clientId);

                return (
                  <div key={t.clientId} className="adminTicketBlock">
                    {renderTicketCard(t, idx)}

                    {showEditInline ? (
                      <div
                        className={[
                          "adminTicketsInlineEditor",
                          "isEdit",
                          isClosing && closingKey === t.clientId ? "isClosing" : "isOpen",
                        ].join(" ")}
                      >
                        {editorNode}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <EditorShell
          isOpen={isOpen}
          onRequestClose={closeEditor}
          editorWidth={420}
          editorGap={14}
          stickyTop={120}
          left={
            <div className="adminTicketsList">
              {sorted.length === 0 ? (
                <div className="adminEventEmpty">Aucun ticket. Clique sur “Nouveau ticket”.</div>
              ) : filtered.length === 0 ? (
                <div className="adminEventEmpty">Aucun ticket ne correspond à “{query.trim()}”.</div>
              ) : (
                filtered.map((t) => {
                  const idx = sorted.findIndex((x) => x.clientId === t.clientId);
                  return renderTicketCard(t, idx);
                })
              )}
            </div>
          }
          right={isOpen ? editorNode : null}
        />
      )}
    </FlexPanel>
  );
}
