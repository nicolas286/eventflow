import type { PublicEventProduct } from "@app/modules/public/events/schemas/public.eventDetailBySlug.schema";
import { formatMoney } from "@shared/helpers/normalize";
import { Button } from "@shared/ui/components";
import "./WidgetTicketCard.css";

type Props = {
  product: PublicEventProduct;
  soldOut: boolean;
  unavailable?: boolean;
  currency: string;
  qty: number;
  maxQty: number;
  updateQty: (productId: string, qty: number) => void;
};

export function WidgetTicketCard({
  product,
  soldOut,
  unavailable = false,
  currency,
  qty,
  maxQty,
  updateQty,
}: Props) {
  return (
    <div
      key={product.id}
      className={`widgetTicketCard ${soldOut || unavailable ? "isSoldOut" : ""} ${qty > 0 ? "isSelected" : ""}`}
    >
      <div className="widgetTicketTitle">{product.name}</div>

      <div className="widgetTicketPrice">
        {formatMoney(product.priceCents, currency)}
      </div>

      {unavailable ? (
        <div className="widgetTicketDesc">
          Paiement temporairement indisponible
        </div>
      ) : null}

      {product.description && (
        <div className="widgetTicketDesc">{product.description}</div>
      )}

      <div className="widgetQtyBlock">
        <Button
          className="widgetButton"
          label="−"
          onClick={() => updateQty(product.id, qty - 1)}
          disabled={qty <= 0}
        />

        <input
          type="number"
          min={0}
          max={unavailable ? qty : maxQty}
          value={qty}
          onChange={(e) => updateQty(product.id, Number(e.target.value))}
          disabled={soldOut}
        />

        <Button
          className="widgetButton"
          label="+"
          onClick={() => updateQty(product.id, qty + 1)}
          disabled={soldOut || unavailable || qty >= maxQty}
        />
      </div>
    </div>
  );
}
