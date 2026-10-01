import type { PublicOrgProfileOverviewForEventPage } from "../../events/schemas/public.eventDetailBySlug.schema";

export function SellerIdentity({ org }: { org: PublicOrgProfileOverviewForEventPage }) {
  return (
    <div>
      <div><strong>{org.sellerLegalName || org.displayName}</strong></div>
      {org.sellerAddress ? <div style={{ whiteSpace: "pre-line" }}>{org.sellerAddress}</div> : null}
      {org.sellerBusinessNumber ? <div>N° d’entreprise / TVA : {org.sellerBusinessNumber}</div> : null}
      {org.phone ? <div>Téléphone : <a href={`tel:${org.phone}`}>{org.phone}</a></div> : null}
      {org.sellerType === "non_professional" ? (
        <div>Le vendeur déclare agir à titre non professionnel. Les règles de protection des consommateurs applicables aux ventes professionnelles ne s’appliquent pas nécessairement.</div>
      ) : null}
    </div>
  );
}
