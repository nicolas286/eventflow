import {
  isEmailRateLimitMessage,
  humanEmailRateLimitMessage,
} from "./emailRateLimit";

export function humanBusinessMessage(msg: string): string | null {
  const m = msg.trim();

  // ------------------------------------------------------------------
  // Exact matches
  // ------------------------------------------------------------------

  const exactMessages: Record<string, string> = {
    PLAN_LIMIT_REGISTRATIONS_PER_EVENT:
      "Limite du nombre d’inscriptions par événement atteinte pour votre abonnement actuel.",

    PLAN_LIMIT_PAID_EVENTS_PER_YEAR:
      "Plan gratuit : limite d’événements avec tickets payants atteinte pour cette année. Passez sur Starter pour continuer.",

    PLAN_LIMIT:
      "Limite de votre abonnement atteinte. Passez sur un plan supérieur pour continuer.",

    FORBIDDEN: "Accès refusé : vous n'avez pas les droits nécessaires.",

    NOT_AUTHENTICATED: "Votre session a expiré. Reconnectez-vous.",

    EVENT_MISMATCH: "Ce ticket n’est pas lié à cet événement.",

    TICKET_NOT_FOUND: "Ticket introuvable.",

    TICKET_CANCELLED: "Ce ticket a été annulé.",

    TICKET_INVALID: "Ce ticket est invalide.",

    CONFLICT: "Vous avez déjà créé une organisation.",

    ORG_ALREADY_EXISTS: "Vous avez déjà créé une organisation.",

    INVALID_REGISTER_PAYLOAD:
      "Certaines informations de réservation sont invalides. Vérifiez le formulaire puis réessayez.",

    INVALID_PAYLOAD:
      "Certaines données envoyées sont invalides. Vérifiez le formulaire puis réessayez.",

    BUYER_EMAIL_REQUIRED:
      "Veuillez indiquer une adresse email pour recevoir la confirmation de réservation.",

    MISSING_CAPTCHA_TOKEN:
      "La vérification anti-robot n’a pas pu être effectuée. Rechargez la page puis réessayez.",

    INVALID_JSON:
      "La demande envoyée est invalide. Rechargez la page puis réessayez.",

    ORG_STRIPE_ONBOARDING_INCOMPLETE:
      "Les paiements de cet événement sont temporairement indisponibles pendant la configuration Stripe de l’organisateur. Veuillez réessayer plus tard.",

    STRIPE_API_ERROR:
      "Stripe n’a pas pu traiter la demande. Réessayez dans quelques instants.",

    SUBSCRIPTION_START_FAILED:
      "L’abonnement Stripe n’a pas pu être démarré. Veuillez réessayer dans quelques instants.",

    STRIPE_CANCEL_SUB_FAILED:
      "L’abonnement Stripe n’a pas pu être annulé. Le compte n’a pas été supprimé afin d’éviter une facturation orpheline. Réessayez dans quelques instants.",

    PAYMENTS_TEMPORARILY_DISABLED:
      "Les paiements sont temporairement indisponibles. Veuillez réessayer plus tard.",

    MOLLIE_HISTORY_READ_ONLY:
      "Mollie n’est plus disponible. Configurez Stripe pour réactiver les paiements de vos événements.",
  };

  const exact = exactMessages[m];
  if (exact) return exact;

  // ------------------------------------------------------------------
  // Validation messages
  // ------------------------------------------------------------------

  const regexMessages: Array<[RegExp, string]> = [
    [
      /VALIDATION_ERROR:\s*type is required/i,
      "Veuillez choisir un type d’organisation.",
    ],

    [
      /VALIDATION_ERROR:\s*invalid type/i,
      "Le type d’organisation est invalide.",
    ],

    [
      /VALIDATION_ERROR:\s*name is required/i,
      "Veuillez indiquer le nom de l’organisation.",
    ],

    [
      /VALIDATION_ERROR:\s*name must be between 3 and 120 characters/i,
      "Le nom doit contenir entre 3 et 120 caractères.",
    ],

    [/VALIDATION_ERROR:\s*org_id is required/i, "Organisation introuvable."],

    [
      /VALIDATION_ERROR:\s*name cannot be empty/i,
      "Le nom de l’organisation est obligatoire.",
    ],

    [
      /VALIDATION_ERROR:\s*name too short/i,
      "Le nom doit contenir au moins 3 caractères.",
    ],

    [
      /VALIDATION_ERROR:\s*name too long/i,
      "Le nom ne peut pas dépasser 120 caractères.",
    ],

    [
      /VALIDATION_ERROR:\s*description too long/i,
      "La description ne peut pas dépasser 1000 caractères.",
    ],

    [
      /VALIDATION_ERROR:\s*public_email too long/i,
      "L’adresse email publique est trop longue.",
    ],

    [
      /VALIDATION_ERROR:\s*phone too short/i,
      "Le numéro de téléphone est trop court.",
    ],

    [
      /VALIDATION_ERROR:\s*phone too long/i,
      "Le numéro de téléphone est trop long.",
    ],

    [
      /VALIDATION_ERROR:\s*website too short/i,
      "L’URL du site web est trop courte.",
    ],

    [
      /VALIDATION_ERROR:\s*website too long/i,
      "L’URL du site web est trop longue.",
    ],

    [
      /VALIDATION_ERROR:\s*email_reminder_days_before must be >= 0/i,
      "Le délai de rappel email ne peut pas être négatif.",
    ],

    [
      /MOLLIE_PAYMENT_CREATE_FAILED|payment method is not activated/i,
      "Le mode de paiement sélectionné n’est pas encore activé sur le compte Mollie. Activez-le dans Mollie ou choisissez un autre moyen de paiement.",
    ],

    [
      /Edge Function returned a non-2xx status code/i,
      "Une erreur serveur est survenue pendant la réservation. Veuillez réessayer dans quelques instants.",
    ],

    // ------------------------------------------------------------------
    // Organization billing
    // ------------------------------------------------------------------

    [
      /VALIDATION_ERROR:\s*invalid payload/i,
      "Les données envoyées sont invalides.",
    ],

    [
      /VALIDATION_ERROR:\s*forbidden billing validation fields/i,
      "Les champs de validation TVA ne peuvent pas être modifiés manuellement.",
    ],

    [/VALIDATION_ERROR:\s*org_id is required/i, "Organisation introuvable."],

    [
      /VALIDATION_ERROR:\s*no fields to update/i,
      "Aucune information de facturation à mettre à jour.",
    ],

    [
      /VALIDATION_ERROR:\s*missing required fields for first billing setup/i,
      "Veuillez compléter les informations obligatoires de facturation.",
    ],

    [
      /VALIDATION_ERROR:\s*legal_name cannot be empty/i,
      "La raison sociale est obligatoire.",
    ],

    [
      /VALIDATION_ERROR:\s*legal_name too short/i,
      "La raison sociale doit contenir au moins 3 caractères.",
    ],

    [
      /VALIDATION_ERROR:\s*legal_name too long/i,
      "La raison sociale ne peut pas dépasser 160 caractères.",
    ],

    [
      /VALIDATION_ERROR:\s*address_line1 cannot be empty/i,
      "L’adresse est obligatoire.",
    ],

    [
      /VALIDATION_ERROR:\s*address_line1 too short/i,
      "L’adresse est trop courte.",
    ],

    [
      /VALIDATION_ERROR:\s*address_line1 too long/i,
      "L’adresse ne peut pas dépasser 200 caractères.",
    ],

    [
      /VALIDATION_ERROR:\s*address_line2 too long/i,
      "Le complément d’adresse ne peut pas dépasser 200 caractères.",
    ],

    [
      /VALIDATION_ERROR:\s*postal_code cannot be empty/i,
      "Le code postal est obligatoire.",
    ],

    [
      /VALIDATION_ERROR:\s*postal_code too short/i,
      "Le code postal est trop court.",
    ],

    [
      /VALIDATION_ERROR:\s*postal_code too long/i,
      "Le code postal ne peut pas dépasser 20 caractères.",
    ],

    [/VALIDATION_ERROR:\s*city cannot be empty/i, "La ville est obligatoire."],

    [/VALIDATION_ERROR:\s*city too short/i, "La ville est trop courte."],

    [
      /VALIDATION_ERROR:\s*city too long/i,
      "La ville ne peut pas dépasser 120 caractères.",
    ],

    [
      /VALIDATION_ERROR:\s*country_code cannot be empty/i,
      "Le pays est obligatoire.",
    ],

    [
      /VALIDATION_ERROR:\s*country_code must be ISO-2/i,
      "Le code pays est invalide.",
    ],

    [
      /VALIDATION_ERROR:\s*vat_country_code must be ISO-2/i,
      "Le pays TVA est invalide.",
    ],

    [
      /VALIDATION_ERROR:\s*vat_number too short/i,
      "Le numéro de TVA est trop court.",
    ],

    [
      /VALIDATION_ERROR:\s*vat_number too long/i,
      "Le numéro de TVA est trop long.",
    ],

    [
      /VALIDATION_ERROR:\s*billing_email too long/i,
      "L’adresse email de facturation est trop longue.",
    ],

    [
      /VALIDATION_ERROR:\s*billing_email invalid/i,
      "L’adresse email de facturation est invalide.",
    ],

    [
      /VALIDATION_ERROR:\s*invoice_reference too long/i,
      "La référence facture ne peut pas dépasser 64 caractères.",
    ],

    [
      /VALIDATION_ERROR:\s*vat_number required when vat_country_code is set/i,
      "Le numéro de TVA est requis si le pays TVA est renseigné.",
    ],

    [
      /VALIDATION_ERROR:\s*vat_country_code required when vat_number is set/i,
      "Le pays TVA est requis si le numéro de TVA est renseigné.",
    ],

    [
      /VALIDATION_ERROR:\s*invalid uuid or value type/i,
      "Certaines données envoyées sont invalides.",
    ],

    // ------------------------------------------------------------------
    // Event products
    // ------------------------------------------------------------------

    [
      /VALIDATION_ERROR:\s*product event_id is required/i,
      "Événement introuvable.",
    ],

    [
      /VALIDATION_ERROR:\s*product name is required/i,
      "Veuillez indiquer le nom du produit.",
    ],

    [
      /VALIDATION_ERROR:\s*product name too short/i,
      "Le nom du produit doit contenir au moins 2 caractères.",
    ],

    [
      /VALIDATION_ERROR:\s*product name too long/i,
      "Le nom du produit ne peut pas dépasser 80 caractères.",
    ],

    [
      /VALIDATION_ERROR:\s*product description too long/i,
      "La description du produit ne peut pas dépasser 500 caractères.",
    ],

    [
      /VALIDATION_ERROR:\s*product price_cents must be between 0 and 10000000/i,
      "Le prix doit être compris entre 0 € et 100 000 €.",
    ],

    [
      /VALIDATION_ERROR:\s*product unsupported currency/i,
      "Cette devise n’est pas prise en charge pour ce produit.",
    ],

    [
      /VALIDATION_ERROR:\s*product stock_qty must be >= 0/i,
      "Le stock du produit ne peut pas être négatif.",
    ],

    [
      /VALIDATION_ERROR:\s*product sort_order must be between 0 and 1000/i,
      "L’ordre d’affichage du produit doit être compris entre 0 et 1000.",
    ],

    [
      /VALIDATION_ERROR:\s*product attendees_per_unit must be between 1 and 20/i,
      "Le nombre de participants par unité doit être compris entre 1 et 20.",
    ],

    [
      /VALIDATION_ERROR:\s*product close_event_when_sold_out requires is_gatekeeper=true/i,
      "La fermeture automatique de l’événement nécessite un produit principal.",
    ],
    [
      /VALIDATION_ERROR:\s*product product_id is required/i,
      "Produit introuvable.",
    ],

    [
      /VALIDATION_ERROR:\s*product name is required/i,
      "Veuillez indiquer le nom du produit.",
    ],
  ];

  for (const [regex, message] of regexMessages) {
    if (regex.test(m)) {
      return message;
    }
  }

  if (isEmailRateLimitMessage(m)) {
    return humanEmailRateLimitMessage();
  }

  return null;
}
