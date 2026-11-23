type CheckoutTermsState = {
  accepted: boolean;
  requiresOrganizerTerms: boolean;
  salesTermsRead: boolean;
  charterRequired?: boolean;
  charterRead?: boolean;
};

export function getCheckoutTermsError({
  accepted,
  requiresOrganizerTerms,
  salesTermsRead,
  charterRequired = false,
  charterRead = false,
}: CheckoutTermsState): string | null {
  if (requiresOrganizerTerms && !salesTermsRead) {
    return "Lisez les conditions de l’organisateur, puis cochez la case d’acceptation pour continuer.";
  }
  if (charterRequired && !charterRead) {
    return "Lisez la charte de l’événement, puis cochez la case d’acceptation pour continuer.";
  }
  if (!accepted) {
    return "Vous devez accepter les conditions en cochant la case ci-dessus pour continuer.";
  }
  return null;
}
