import { escapeHtml } from "../../text.ts";

export type AcceptedOrderContract = {
  platformVersion: string | null;
  platformText: string | null;
  organizerVersion: string | null;
  organizerText: string | null;
  seller: unknown;
  acceptedAt: string | null;
};

export function acceptedSellerContact(seller: unknown) {
  if (!seller || typeof seller !== "object" || Array.isArray(seller)) {
    return null;
  }
  const values = new Map<string, unknown>(Object.entries(seller));
  const field = (key: string) => {
    const value = values.get(key);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };
  return {
    name: field("legal_name") ?? field("display_name") ?? "L’organisateur",
    email: field("email"),
    phone: field("phone"),
    website: field("website"),
  };
}

export function buildAcceptedContractHtml(
  contract: AcceptedOrderContract,
): string {
  // Historical orders do not acquire a fictitious acceptance on resend.
  if (!contract.acceptedAt) return "";
  const identity = contract.seller && typeof contract.seller === "object" &&
      !Array.isArray(contract.seller)
    ? Object.entries(contract.seller).filter((
      entry,
    ): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1].length > 0
    )
    : [];
  const labels: Record<string, string> = {
    display_name: "Organisateur",
    legal_name: "Vendeur",
    address: "Adresse",
    business_number: "Numéro d’entreprise",
    seller_type: "Qualité du vendeur",
    email: "E-mail",
    phone: "Téléphone",
    website: "Site",
  };
  const seller = identity.map(([key, value]) =>
    `<p>${escapeHtml(labels[key] ?? key)} : ${escapeHtml(value)}</p>`
  ).join("");
  const section = (
    title: string,
    version: string | null,
    text: string | null,
  ) =>
    text
      ? `<h3>${escapeHtml(title)} — version ${
        escapeHtml(version ?? "")
      }</h3><div style="white-space:pre-wrap;overflow-wrap:anywhere">${
        escapeHtml(text)
      }</div>`
      : "";
  return `<section><h2>Copie des conditions acceptées</h2><p>Acceptées le ${
    escapeHtml(contract.acceptedAt)
  }</p>${seller}${
    section(
      "Conditions de l’organisateur",
      contract.organizerVersion,
      contract.organizerText,
    )
  }${
    section(
      "Conditions Eventflow",
      contract.platformVersion,
      contract.platformText,
    )
  }</section>`;
}
