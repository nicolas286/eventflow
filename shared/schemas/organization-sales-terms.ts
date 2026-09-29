import { z } from "zod";

export const DEFAULT_ORGANIZATION_SALES_TERMS_VERSION = "default-2026-09-29";

export const EVENTFLOW_BUYER_TERMS_VERSION = "2026-09-29";

export const DEFAULT_ORGANIZATION_SALES_TERMS = `# Conditions de réservation et de vente

## Identité du vendeur

Le vendeur des billets et l’organisateur de l’événement est l’organisation identifiée sur la page de l’événement. Eventflow fournit la plateforme technique et n’est pas le vendeur.

## Réservation et paiement

La réservation payante devient définitive après confirmation du paiement. Le paiement est encaissé directement par l’organisateur au moyen de son compte Stripe connecté.

## Annulation par le participant

Toute demande d’annulation ou de remboursement doit être adressée directement à l’organisateur au moyen des coordonnées affichées sur la page de l’événement. Un remboursement n’est accordé que lorsque l’organisateur l’accepte ou lorsque la législation applicable l’impose.

## Annulation ou modification par l’organisateur

Si l’événement est annulé ou substantiellement modifié, l’organisateur informe les participants et traite les remboursements conformément à la législation applicable et aux modalités communiquées pour l’événement.

## Billets

Le participant est responsable de la conservation de son billet et de son code d’accès. Un billet remboursé, annulé, déjà utilisé ou rendu invalide ne permet plus l’accès à l’événement.

## Contact

Les questions concernant l’événement, l’accès, une annulation ou un remboursement doivent être adressées à l’organisateur via ses coordonnées publiques.`;

export const organizationSalesTermsSchema = z
  .string()
  .trim()
  .min(
    200,
    "Les conditions organisateur doivent contenir au moins 200 caractères",
  )
  .max(10_000, "Les conditions organisateur sont trop longues");

export const acceptOrganizationSalesTermsSchema = z
  .object({
    action: z.literal("accept_terms"),
    orgId: z.uuid(),
    salesTerms: organizationSalesTermsSchema,
    confirmed: z.literal(true),
  })
  .strict();

export type AcceptOrganizationSalesTerms = z.infer<
  typeof acceptOrganizationSalesTermsSchema
>;
