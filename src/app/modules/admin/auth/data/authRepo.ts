import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseSession } from "@gateways/supabase/supabaseClient";
import { normalizeError } from "@errors/errors";
import { signOutFromBrowser } from "@gateways/supabase/signOutFromBrowser";
import { loginSchema, signupSchema } from "../schemas/admin.auth.schema";
import type { LoginInput, SignupInput } from "../schemas/admin.auth.schema";

export type SignUpResult =
  | { status: "CONFIRMATION_REQUIRED" }
  | { status: "SIGNED_IN" };

export const authRepo = {
  async getSession(): Promise<Session | null> {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session ?? null;
    } catch (e) {
      throw normalizeError(e, "Impossible de récupérer la session.");
    }
  },

async signIn(
  input: LoginInput,
  opts?: { rememberMe?: boolean }
): Promise<void> {
  try {
    const parsed = loginSchema.parse(input);

    const client = opts?.rememberMe ? supabase : supabaseSession;

    const { data, error } = await client.auth.signInWithPassword(parsed);
    if (error) throw error;

    if (!opts?.rememberMe && data.session) {
      await supabase.auth.setSession(data.session);
    }

  } catch (e) {
    throw normalizeError(e, "Connexion impossible.");
  }
},

  async signUp(input: SignupInput): Promise<SignUpResult> {
  try {
    const parsed = signupSchema.parse(input);
    const { email, password } = parsed;

    const emailRedirectTo = `${window.location.origin}/admin`; 

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo },
    });

    if (error) throw error;

    if (!data.session) return { status: "CONFIRMATION_REQUIRED" };
    return { status: "SIGNED_IN" };
  } catch (e) {
    throw normalizeError(e, "Inscription impossible.");
  }
},


  async signOut(): Promise<void> {
    try {
      await signOutFromBrowser();
    } catch (e) {
      throw normalizeError(e, "Déconnexion impossible.");
    }
  },

   async requestPasswordReset(email: string, opts?: { redirectTo?: string }): Promise<void> {
    try {
      const redirectTo = opts?.redirectTo ?? `${window.location.origin}/admin/reset-password`;

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (error) throw error;
    } catch (e) {
      throw normalizeError(e, "Impossible d’envoyer l’email de réinitialisation.");
    }
  },

  async updatePassword(newPassword: string): Promise<void> {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
    } catch (e) {
      throw normalizeError(e, "Impossible de mettre à jour le mot de passe.");
    }
  },
};
