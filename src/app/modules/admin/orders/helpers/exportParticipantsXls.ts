/**
 * Génère et télécharge un fichier Excel (.xlsx) contenant la liste des participants d’un événement.
 *
 * Fonction pure côté métier (aucune dépendance UI) :
 * - Ne modifie aucun état applicatif.
 * - Déclenche uniquement le téléchargement du fichier côté navigateur.
 *
 * Données exportées :
 * - Colonnes fixes : Réf commande, Statut, Billet, Index.
 * - Colonnes dynamiques : une colonne par champ du formulaire (`regFields`).
 *   - Utilise le `label` si présent, sinon `fieldKey`.
 *   - Gère les collisions de labels (ex: deux champs avec le même nom)
 *     en suffixant automatiquement : "Champ", "Champ (2)", etc.
 *
 * Remplissage :
 * - Chaque ligne correspond à un participant issu de `localAttendees`
 *   (cette liste contrôle exactement ce qui est exporté : tous, filtrés, confirmés, etc.).
 * - Les réponses sont récupérées via `filledFieldsByAttendeeId`.
 *
 * Tri :
 * - sortMode = "alpha" (défaut)
 *   → tri alphabétique via `computeIdentityTitle`.
 *
 * - sortMode = "orderRef"
 *   → tri groupé par référence de commande (8 premiers caractères de `orderId`),
 *     puis par `attendeeIndex` (numérique si possible),
 *     puis fallback alphabétique.
 *   → tri stable : l’ordre relatif est conservé en cas d’égalité.
 *
 * Nom du fichier :
 * - Basé sur le titre de l’événement.
 * - Sécurisé via `safeFilename`.
 *
 * Important :
 * - `computeIdentityTitle` doit toujours retourner une string exploitable pour le tri.
 * - Cette fonction est déterministe : mêmes entrées → même fichier.
 */

import ExcelJS from "exceljs";
import { sortAlpha } from "@helpers/logic";
import type { EventFormField } from "@shared/models/db/db.eventFormFields.schema";
import type { Attendee } from "@shared/models/db/db.attendee.schema";
import { safeFilename } from "@helpers/normalize";

const FIXED_COLS = ["Réf commande", "Statut", "Billet", "Index"] as const;

export type ExportParticipantsXlsInput = {
  shouldDownload?: () => boolean;
  eventTitle?: string | null;
  regFields: EventFormField[];
  localAttendees: Attendee[];
  filledFieldsByAttendeeId: Map<string, { key: string; value: unknown }[]>;
  computeIdentityTitle: (attendeeId: string) => string;
  sortMode?: "alpha" | "orderRef";

  /** alternance par "row" (participant) ou par "order" (commande) */
  stripeMode?: "row" | "order";
};

function getOrderRef(att: Attendee): string {
  const orderId = String(att.orderId ?? "");
  return orderId ? orderId.slice(0, 8) : "";
}

function parseIndex(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function stableSort<T>(arr: T[], cmp: (a: T, b: T) => number): T[] {
  return arr
    .map((item, idx) => ({ item, idx }))
    .sort((x, y) => cmp(x.item, y.item) || x.idx - y.idx)
    .map((x) => x.item);
}

function toDisplayValue(v: unknown): string | number {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "Oui" : "Non";

  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export async function exportParticipantsXls(input: ExportParticipantsXlsInput) {
  const {
    eventTitle,
    regFields,
    localAttendees,
    filledFieldsByAttendeeId,
    computeIdentityTitle,
    sortMode = "alpha",
    stripeMode = "order",
  } = input;

  const formCols: { header: string; key: string }[] = [];
  const used = new Map<string, number>();

  for (const f of regFields) {
    const base = (f.label?.trim() ? f.label.trim() : f.fieldKey).trim() || f.fieldKey;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const header = count === 1 ? base : `${base} (${count})`;
    formCols.push({ header, key: f.fieldKey });
  }

  const headers = [...FIXED_COLS, ...formCols.map((c) => c.header)];

  const attendeesSorted =
    sortMode === "alpha"
      ? sortAlpha(localAttendees, (att) => computeIdentityTitle(att.id))
      : stableSort(localAttendees, (a, b) => {
          const ar = getOrderRef(a);
          const br = getOrderRef(b);
          if (ar !== br) return ar.localeCompare(br, "fr", { sensitivity: "base" });

          const ai = parseIndex(a.attendeeIndex);
          const bi = parseIndex(b.attendeeIndex);
          if (ai == null && bi != null) return 1;
          if (ai != null && bi == null) return -1;
          if (ai != null && bi != null && ai !== bi) return ai - bi;

          return computeIdentityTitle(a.id).localeCompare(computeIdentityTitle(b.id), "fr", {
            sensitivity: "base",
          });
        });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Participants", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const HEADER_BG = "FF0B2A4A";
  const HEADER_FG = "FFFFFFFF";
  const STRIPE_A = "FFEAF2FF";
  const STRIPE_B = "FFD7E7FF";

  const headerRow = ws.addRow(headers);
  headerRow.height = 18;

  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_FG } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BG } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FF1C3B5A" } },
      left: { style: "thin", color: { argb: "FF1C3B5A" } },
      bottom: { style: "thin", color: { argb: "FF1C3B5A" } },
      right: { style: "thin", color: { argb: "FF1C3B5A" } },
    };
  });

  ws.columns = headers.map((h) => ({
    header: h,
    key: h,
    width: Math.min(Math.max(h.length, 14), 38),
  }));

  let stripeToggle = false;
  let lastOrderRef: string | null = null;

  for (const att of attendeesSorted) {
    const orderRef = getOrderRef(att);

    if (stripeMode === "order") {
      if (lastOrderRef == null) lastOrderRef = orderRef;
      if (orderRef !== lastOrderRef) {
        stripeToggle = !stripeToggle;
        lastOrderRef = orderRef;
      }
    } else {
      stripeToggle = !stripeToggle;
    }

    const filled = filledFieldsByAttendeeId.get(att.id) ?? [];
    const filledByKey = new Map(filled.map((x) => [x.key, x.value]));

    const values: (string | number)[] = [
      orderRef,
      att.status ?? "",
      att.productNameSnapshot ?? "",
      typeof att.attendeeIndex === "number" ? att.attendeeIndex : att.attendeeIndex ?? "",
      ...formCols.map((c) => toDisplayValue(filledByKey.get(c.key))),
    ];

    const row = ws.addRow(values);

    const bg = stripeToggle ? STRIPE_A : STRIPE_B;
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFB6C7DA" } },
        left: { style: "thin", color: { argb: "FFB6C7DA" } },
        bottom: { style: "thin", color: { argb: "FFB6C7DA" } },
        right: { style: "thin", color: { argb: "FFB6C7DA" } },
      };
    });
  }

  const safeEventTitle = safeFilename(eventTitle ?? "event", "event", 60);

  const buffer = await wb.xlsx.writeBuffer();
  if (input.shouldDownload && !input.shouldDownload()) return;
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `participants-${safeEventTitle}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}