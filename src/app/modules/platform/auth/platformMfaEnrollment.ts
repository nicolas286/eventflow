export type PlatformTotpFactor = {
  id: string;
  status: string;
};

export type PlatformTotpEnrollment = {
  id: string;
  qrCode: string;
  secret: string;
};

export type PlatformMfaPreparation =
  | { kind: "challenge"; factorId: string }
  | {
      kind: "enrollment";
      factorId: string;
      qrCode: string;
      secret: string;
    };

export type PlatformMfaOperations = {
  listFactors: () => Promise<PlatformTotpFactor[]>;
  unenroll: (factorId: string) => Promise<void>;
  enroll: () => Promise<PlatformTotpEnrollment>;
};

const enrollmentByUser = new Map<
  string,
  Promise<Extract<PlatformMfaPreparation, { kind: "enrollment" }>>
>();

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

async function removeUnverifiedFactors(
  factors: PlatformTotpFactor[],
  operations: PlatformMfaOperations,
) {
  for (const factor of factors.filter((item) => item.status !== "verified")) {
    try {
      await operations.unenroll(factor.id);
    } catch (error) {
      if (errorCode(error) !== "mfa_factor_not_found") throw error;
    }
  }
}

async function createEnrollment(
  initialFactors: PlatformTotpFactor[],
  operations: PlatformMfaOperations,
) {
  await removeUnverifiedFactors(initialFactors, operations);

  try {
    const enrollment = await operations.enroll();
    return {
      kind: "enrollment" as const,
      factorId: enrollment.id,
      qrCode: enrollment.qrCode,
      secret: enrollment.secret,
    };
  } catch (error) {
    if (errorCode(error) !== "mfa_factor_name_conflict") throw error;

    const conflictingFactors = await operations.listFactors();
    await removeUnverifiedFactors(conflictingFactors, operations);
    const enrollment = await operations.enroll();
    return {
      kind: "enrollment" as const,
      factorId: enrollment.id,
      qrCode: enrollment.qrCode,
      secret: enrollment.secret,
    };
  }
}

export async function preparePlatformMfa(
  userId: string,
  operations: PlatformMfaOperations,
): Promise<PlatformMfaPreparation> {
  const factors = await operations.listFactors();
  const verified = factors.find((item) => item.status === "verified");
  if (verified) {
    enrollmentByUser.delete(userId);
    return { kind: "challenge", factorId: verified.id };
  }

  const existing = enrollmentByUser.get(userId);
  if (existing) return await existing;

  const pending = createEnrollment(factors, operations);
  enrollmentByUser.set(userId, pending);
  try {
    return await pending;
  } catch (error) {
    if (enrollmentByUser.get(userId) === pending) {
      enrollmentByUser.delete(userId);
    }
    throw error;
  }
}

export function clearPlatformMfaEnrollment(userId: string) {
  enrollmentByUser.delete(userId);
}
