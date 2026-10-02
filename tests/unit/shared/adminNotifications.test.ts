import { describe, expect, it } from "vitest";
import {
  getPlatformAgreementNotification,
  getPlatformNotifications,
} from "../../../src/app/modules/admin/notices/adminNotifications";

const versions = {
  connectTermsAcceptedVersion: "2026-10-01",
  dpaAcceptedVersion: "2026-10-01",
  platformTermsAcceptedVersion: "2026-10-01",
  privacyAcceptedVersion: "2026-10-01",
};
const context = {
  organization: { id: "0dca60fb-7310-4734-8551-fb6db3b29fc9" },
  profile: { userId: "84a9a677-c174-40e5-b78b-d967780761e1" },
  membership: [
    {
      orgId: "0dca60fb-7310-4734-8551-fb6db3b29fc9",
      userId: "84a9a677-c174-40e5-b78b-d967780761e1",
      role: "owner",
    },
  ],
  organizationProfile: {},
};

describe("admin notifications", () => {
  it("keeps the legal acceptance action visible and non-dismissible", () => {
    const notification = getPlatformAgreementNotification(context);

    expect(notification?.title).toContain("Action requise");
    expect(notification?.to).toBe("/admin/structure#platform-agreements");
    expect(notification?.dismissible).toBe(false);
  });

  it("removes the legal action only after every current version is recorded", () => {
    expect(
      getPlatformAgreementNotification({
        ...context,
        organizationProfile: versions,
      }),
    ).toBeNull();
    expect(
      getPlatformAgreementNotification({
        ...context,
        organizationProfile: {
          ...versions,
          privacyAcceptedVersion: "old",
        },
      }),
    ).not.toBeNull();
  });

  it.each([
    {
      orgId: "0dca60fb-7310-4734-8551-fb6db3b29fc9",
      userId: "84a9a677-c174-40e5-b78b-d967780761e1",
      role: "member",
    },
    {
      orgId: "86aceb03-dde7-49dc-829d-f2eb995c12e0",
      userId: "84a9a677-c174-40e5-b78b-d967780761e1",
      role: "owner",
    },
    {
      orgId: "0dca60fb-7310-4734-8551-fb6db3b29fc9",
      userId: "55d8b3a2-491e-4579-9f32-95f79db800d4",
      role: "owner",
    },
  ])(
    "does not expose the legal action to a user without authority: %j",
    (membership) => {
      expect(
        getPlatformAgreementNotification({
          ...context,
          membership: [membership],
        }),
      ).toBeNull();
    },
  );

  it("turns platform status messages into dismissible notifications", () => {
    const notifications = getPlatformNotifications({
      registrationsOpen: false,
      registrationPublicMessage:
        "Les inscriptions sont temporairement indisponibles.",
      announcement: {
        id: "d32ccf91-419d-4acc-b71d-dfc3f06d6488",
        title: "Maintenance planifiée",
        body: "Une intervention est prévue ce soir.",
        level: "maintenance",
        audience: "organizer",
        startsAt: null,
        endsAt: null,
      },
    });

    expect(notifications).toHaveLength(2);
    expect(notifications.map((notification) => notification.title)).toEqual([
      "Maintenance planifiée",
      "Inscriptions temporairement fermées",
    ]);
    expect(
      notifications.every((notification) => notification.dismissible),
    ).toBe(true);
  });
});
