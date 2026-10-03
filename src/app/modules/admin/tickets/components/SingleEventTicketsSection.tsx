import { useMemo } from "react";
import { supabase } from "@gateways/supabase/supabaseClient";

import "./adminSingleEvent.tickets.desktop.css";
import "./adminSingleEvent.tickets.mobile.css";

import { EventTicketsPanel } from "./EventTicketsPanel/EventTicketsPanel";
import { useCreateEventProduct } from "../../products/hooks/useCreateEventProduct";
import { useDeleteEventProduct } from "../../products/hooks/useDeleteEventProduct";
import { useUpdateEventProduct } from "../../products/hooks/useUpdateEventProduct";

import type { AdminEventDetailEvent } from "../../singleEvent/schemas/admin.eventDetail.schema";
import type { EventProducts } from "@shared/models/db/db.eventProducts.schema";

import { toRows } from "@helpers/normalize";
import { OrganizerMutationObsoleteError } from "../../singleEvent/hooks/useScopedEventMutation";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";

export function SingleEventTicketsSection(props: {
  orgId: string;
  event: AdminEventDetailEvent;
  products: EventProducts;
  onChanged: () => Promise<void>;
}) {
  const { orgId, event, products, onChanged } = props;
  const { session } = useAuth();
  const sessionScope = getSessionScope(session);

  const createProduct = useCreateEventProduct({ supabase, orgId, eventId: event.id });
  const updateProduct = useUpdateEventProduct({ supabase, orgId, eventId: event.id });
  const removeProduct = useDeleteEventProduct({ supabase, orgId, eventId: event.id });
  const isCurrentScope = () => createProduct.isCurrentScope() && updateProduct.isCurrentScope() && removeProduct.isCurrentScope();

  const productsRows = useMemo(() => toRows(products), [products]);

  return (
    <div className="adminEventSection adminSingleEventTickets">
      <EventTicketsPanel
        key={JSON.stringify([sessionScope, orgId, event.id])}
        orgId={orgId}
        event={event}
        products={productsRows}
        createLoading={createProduct.loading}
        createError={createProduct.error}
        updateLoading={updateProduct.loading}
        deleteLoading={removeProduct.loading}
        deleteError={removeProduct.error}
        onCreate={async (input) => {
          if (!isCurrentScope()) throw new OrganizerMutationObsoleteError();
          await createProduct.createEventProduct(input);
          if (!isCurrentScope()) throw new OrganizerMutationObsoleteError();
        }}
        onUpdate={async ({ productId, patch }) => {
          if (!isCurrentScope()) throw new OrganizerMutationObsoleteError();
          await updateProduct.updateEventProduct({ productId, patch });
          if (!isCurrentScope()) throw new OrganizerMutationObsoleteError();
        }}
        onRemove={async (productId) => {
          if (!isCurrentScope()) throw new OrganizerMutationObsoleteError();
          const ok = await removeProduct.deleteEventProduct({ id: productId });
          if (!isCurrentScope()) throw new OrganizerMutationObsoleteError();
          if (!ok) throw new Error("Impossible de supprimer le produit.");
        }}
        isCurrentScope={isCurrentScope}
        onChanged={() => { if (isCurrentScope()) return onChanged(); }}
      />
    </div>
  );
}
