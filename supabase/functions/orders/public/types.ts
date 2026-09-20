export type CheckoutSource = "public" | "widget";

export type RegisterItemInput = {
  eventProductId: string;
  quantity: number;
};

export type RegisterAnswerInput = {
  eventFormFieldId: string;
  value: unknown;
};

export type RegisterAttendeeInput = {
  eventProductId: string;
  answers?: RegisterAnswerInput[];
};

export type RegisterBuyerInput = {
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  isAttendee?: boolean;
};

export type RegisterRequestBody = {
  eventId: string;
  items: RegisterItemInput[];
  attendees: RegisterAttendeeInput[];
  buyer?: RegisterBuyerInput;
  buyerEmail?: string | null;
  turnstileToken: string;
  checkoutSource?: string | null;
  widgetReturnUrl?: string | null;
};

export type NormalizedBuyer = {
  email: string | null;
  name: string | null;
  phone: string | null;
  is_attendee: boolean | null;
};

export type OrderIntentResult = {
  orderId: string;
  bookingToken: string;
  paymentRequired: boolean;
  totalCents: number;
  dueNowCents: number;
  currency: string;
};

export type CheckoutContext = {
  checkoutSource: CheckoutSource;
  widgetReturnUrl: string | null;
  buildRedirectUrl: (orderId: string, bookingToken: string) => string;
};

export type RuntimeConfig = {
  supabaseUrl: string;
  serviceKey: string;
  functionsBase: string;
  appBaseUrl: string;
  edgeServiceToken: string | null;
  registerRateLimitPer10Min: number;
  turnstileSecret: string | null;
  turnstileBypass: boolean;
  debugErrors: boolean;
  allowedOrigins: string[];
};