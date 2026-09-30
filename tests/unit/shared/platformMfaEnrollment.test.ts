import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPlatformMfaEnrollment,
  preparePlatformMfa,
  type PlatformMfaOperations,
} from "../../../src/app/modules/platform/auth/platformMfaEnrollment";

const userIds = ["user-one", "user-two", "user-retry", "user-verified"];

afterEach(() => {
  for (const userId of userIds) clearPlatformMfaEnrollment(userId);
});

describe("platform MFA enrollment", () => {
  it("shares one pending enrollment for concurrent renders of the same account", async () => {
    const unenroll = vi.fn(async () => undefined);
    const enroll = vi.fn(async () => ({
      id: "new-factor",
      qrCode: "qr-data",
      secret: "manual-key",
    }));
    const operations: PlatformMfaOperations = {
      listFactors: vi.fn(async () => [
        { id: "stale-factor", status: "unverified" },
      ]),
      unenroll,
      enroll,
    };

    const [first, second] = await Promise.all([
      preparePlatformMfa("user-one", operations),
      preparePlatformMfa("user-one", operations),
    ]);

    expect(first).toEqual({
      kind: "enrollment",
      factorId: "new-factor",
      qrCode: "qr-data",
      secret: "manual-key",
    });
    expect(second).toEqual(first);
    expect(unenroll).toHaveBeenCalledTimes(1);
    expect(enroll).toHaveBeenCalledTimes(1);
  });

  it("keeps the QR code and manual key available for later mounts", async () => {
    const enroll = vi.fn(async () => ({
      id: "new-factor",
      qrCode: "stable-qr",
      secret: "stable-manual-key",
    }));
    const operations: PlatformMfaOperations = {
      listFactors: vi.fn(async () => []),
      unenroll: vi.fn(async () => undefined),
      enroll,
    };

    const first = await preparePlatformMfa("user-two", operations);
    const second = await preparePlatformMfa("user-two", operations);

    expect(second).toEqual(first);
    expect(enroll).toHaveBeenCalledTimes(1);
  });

  it("uses an existing verified factor without generating a new QR code", async () => {
    const enroll = vi.fn(async () => ({
      id: "unused",
      qrCode: "unused",
      secret: "unused",
    }));
    const operations: PlatformMfaOperations = {
      listFactors: vi.fn(async () => [
        { id: "verified-factor", status: "verified" },
      ]),
      unenroll: vi.fn(async () => undefined),
      enroll,
    };

    await expect(
      preparePlatformMfa("user-verified", operations),
    ).resolves.toEqual({
      kind: "challenge",
      factorId: "verified-factor",
    });
    expect(enroll).not.toHaveBeenCalled();
  });

  it("allows a clean retry when enrollment creation fails", async () => {
    let attempts = 0;
    const operations: PlatformMfaOperations = {
      listFactors: vi.fn(async () => []),
      unenroll: vi.fn(async () => undefined),
      enroll: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary failure");
        return {
          id: "retry-factor",
          qrCode: "retry-qr",
          secret: "retry-manual-key",
        };
      }),
    };

    await expect(preparePlatformMfa("user-retry", operations)).rejects.toThrow(
      "temporary failure",
    );
    await expect(preparePlatformMfa("user-retry", operations)).resolves.toEqual(
      {
        kind: "enrollment",
        factorId: "retry-factor",
        qrCode: "retry-qr",
        secret: "retry-manual-key",
      },
    );
    expect(attempts).toBe(2);
  });
});
