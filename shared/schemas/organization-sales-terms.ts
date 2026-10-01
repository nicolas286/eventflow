import { z } from "zod";

export const DEFAULT_ORGANIZATION_SALES_TERMS_VERSION = "default-2026-10-01";

export const EVENTFLOW_BUYER_TERMS_VERSION = "2026-10-01";

export const DEFAULT_ORGANIZATION_SALES_TERMS =
  `# Conditions de réservation et de vente

## Identité du vendeur

Le vendeur des billets et l’organisateur de l’événement est l’organisation identifiée sur la page de l’événement. Eventflow fournit la plateforme technique et n’est pas le vendeur.

## Réservation et paiement

La réservation payante devient définitive après confirmation du paiement. Le paiement est encaissé directement par l’organisateur au moyen de son compte Stripe connecté.

Le prix total, les éventuels frais et le montant payable immédiatement sont affichés avant validation. Lorsqu’un acompte est proposé, l’organisateur indique le solde, son échéance et ses modalités de paiement dans les informations de l’événement avant la commande. Aucune somme supplémentaire non annoncée ne peut être exigée.

## Livraison et accès aux billets

Les billets électroniques sont délivrés après confirmation du paiement ou de l’inscription gratuite, par e-mail et sur la page de confirmation de la commande. En cas de non-réception, le participant vérifie ses courriers indésirables et contacte l’organisateur. Les conditions d’accès, restrictions d’âge, horaires et prestations incluses sont indiqués sur la page de l’événement avant la réservation.

## Droit de rétractation

Pour une activité de loisirs fournie à une date ou pendant une période déterminée, le droit légal de rétractation de quatorze jours ne s’applique pas lorsque l’exception légale est applicable. Cette absence de rétractation ne supprime pas les droits du participant en cas d’annulation de l’événement ou de prestation non conforme. Pour une prestation ne relevant pas de cette exception, l’organisateur fournit avant la commande les informations et modalités du droit de rétractation applicable.

## Annulation par le participant

Toute demande d’annulation ou de remboursement doit être adressée directement à l’organisateur au moyen des coordonnées affichées sur la page de l’événement. Un remboursement n’est accordé que lorsque l’organisateur l’accepte ou lorsque la législation applicable l’impose.

## Annulation ou modification par l’organisateur

Si l’événement est annulé, l’organisateur informe les participants par les coordonnées de commande et leur communique la procédure et le délai de remboursement des prestations non fournies. En cas de report ou de modification substantielle, il précise les nouvelles modalités et les solutions proposées, dans le respect des droits légaux du participant. Une demande peut toujours être adressée au contact public de l’organisateur ; aucun avoir ou report ne peut être imposé en remplacement d’un remboursement lorsque la loi exige celui-ci.

## Billets

Le participant est responsable de la conservation de son billet et de son code d’accès. Un billet remboursé, annulé, déjà utilisé ou rendu invalide ne permet plus l’accès à l’événement.

## Contact

Les questions concernant l’événement, l’accès, une annulation ou un remboursement doivent être adressées à l’organisateur via ses coordonnées publiques, en mentionnant la référence de commande. L’organisateur accuse réception et apporte une réponse dans un délai raisonnable. Ces conditions ne limitent pas les recours ni les protections impératives applicables au participant.

## Données personnelles

L’organisateur utilise les données nécessaires à la réservation, à la communication relative à l’événement et au contrôle d’accès. Il est responsable de ces traitements et fournit son information sur la protection des données. Eventflow traite ces données pour son compte afin de fournir le service. Aucune inscription à une prospection facultative ne découle de la seule acceptation de ces conditions.`;

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
