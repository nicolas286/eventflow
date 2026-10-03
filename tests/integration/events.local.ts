import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { handleOrganizationsRequest } from "../../supabase/functions/organizations/index.ts";
import { handleEventsRequest } from "../../supabase/functions/events/index.ts";
import {
  eventDetailAdminCoreSchema,
  eventSchema,
  eventsOverviewSchema,
} from "../../shared/schemas/events.ts";
import { z } from "zod";
import { eventProductSchema } from "../../shared/schemas/event-products.ts";
import {
  eventFormFieldGroupSchema,
  eventFormFieldSchema,
} from "../../shared/schemas/event-form-fields-data.ts";
import { promoCodeSchema } from "../../shared/schemas/promo-code-data.ts";

function required(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing synthetic configuration: ${name}`);
  return value;
}

Deno.test("B2 real Auth/HTTP/PostgREST: event isolation, transactional duplication and browser ACLs without business RLS", async () => {
  const base = required("SUPABASE_URL");
  assertEquals(new URL(base).hostname, "127.0.0.1");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(
    base,
    required("SUPABASE_SERVICE_ROLE_KEY"),
    options,
  );
  const users: string[] = [];
  const orgs: string[] = [];
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    (req) =>
      new URL(req.url).pathname.includes("/organizations/")
        ? handleOrganizationsRequest(req)
        : handleEventsRequest(req),
  );
  const origin = `http://127.0.0.1:${server.addr.port}/functions/v1`;
  async function actor() {
    const email = `b2-${crypto.randomUUID()}@example.test`;
    const password = `Synthetic-${crypto.randomUUID()}`;
    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        platform_terms_version: "2026-10-01",
        platform_terms_accepted: true,
      },
    });
    assert(!created.error && created.data.user);
    users.push(created.data.user.id);
    const client = createClient(base, required("SUPABASE_ANON_KEY"), options);
    const signed = await client.auth.signInWithPassword({ email, password });
    assert(!signed.error && signed.data.session);
    return {
      id: created.data.user.id,
      token: signed.data.session.access_token,
      client,
    };
  }
  async function call(
    path: string,
    token: string | null,
    body: unknown,
    status = 200,
  ) {
    const response = await fetch(`${origin}/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const result: unknown = await response.json();
    assertEquals(response.status, status, `${path}: ${JSON.stringify(result)}`);
    return result;
  }
  try {
    const a = await actor();
    const b = await actor();
    const admin = await actor();
    const orgA = z.uuid().parse(
      await call("organizations/create", a.token, {
        type: "association",
        name: "B2 synthetic A",
      }),
    );
    orgs.push(orgA);
    const orgB = z.uuid().parse(
      await call("organizations/create", b.token, {
        type: "association",
        name: "B2 synthetic B",
      }),
    );
    orgs.push(orgB);
    assert(
      !(await service.from("organization_members").insert({
        org_id: orgA,
        user_id: admin.id,
        role: "admin",
      })).error,
    );
    await call("events/overview", null, { orgId: orgA }, 401);
    await call(
      "events/overview",
      "invalid-synthetic-session",
      { orgId: orgA },
      401,
    );
    await call("events/overview", b.token, { orgId: orgA }, 403);
    assertEquals(
      eventsOverviewSchema.parse(
        await call("events/overview", a.token, { orgId: orgA }),
      ).events,
      [],
    );
    const event = eventSchema.parse(
      await call("events/create", a.token, {
        orgId: orgA,
        title: "Synthetic event",
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        depositCents: 0,
        charterText: "Keep snake_key and camelKey in text",
      }),
    );
    assertEquals(event.orgId, orgA);
    assertEquals(event.isPublished, false);
    const other = eventSchema.parse(
      await call("events/create", b.token, {
        orgId: orgB,
        title: "Other synthetic event",
      }),
    );
    await call(
      "events/create",
      a.token,
      { orgId: orgB, title: "Forged event" },
      403,
    );
    await call("events/create", a.token, {
      orgId: orgA,
      title: "Forged event",
      createdBy: b.id,
    }, 400);
    await call("events/create", a.token, {
      orgId: orgA,
      title: "Invalid date",
      startsAt: "invalid",
    }, 400);
    await call("events/detail", a.token, { eventId: other.id }, 403);
    await call("events/update", a.token, {
      eventId: other.id,
      patch: { title: "Forged event" },
    }, 403);
    await call("events/update", a.token, {
      eventId: event.id,
      patch: { orgId: orgB },
    }, 400);
    const updated = eventSchema.parse(
      await call("events/update", admin.token, {
        eventId: event.id,
        patch: { title: "Renamed synthetic event", isPublished: true },
      }),
    );
    assertEquals(updated.title, "Renamed synthetic event");
    assertEquals(updated.isPublished, true);
    const detail = eventDetailAdminCoreSchema.parse(
      await call("events/detail", a.token, {
        orgId: orgA,
        eventSlug: updated.slug,
      }),
    );
    assertEquals(detail.event.id, event.id);
    assertEquals(detail.formFields.length, 10);
    assertEquals(detail.products.length, 1);
    const cloned = eventSchema.parse(
      await call("events/duplicate", a.token, {
        sourceEventId: event.id,
        title: "Synthetic clone",
      }),
    );
    assertEquals(cloned.isPublished, false);
    assertEquals(cloned.orgId, orgA);
    const cloneDetail = eventDetailAdminCoreSchema.parse(
      await call("events/detail", a.token, { eventId: cloned.id }),
    );
    assertEquals(cloneDetail.formFields.length, detail.formFields.length);
    assertEquals(cloneDetail.products.length, detail.products.length);
    assert(
      cloneDetail.formFields.every((field) =>
        !detail.formFields.some((source) => source.id === field.id)
      ),
    );
    assert(
      cloneDetail.products.every((product) =>
        product.reservedQty === 0 && product.soldQty === 0
      ),
    );
    await call("events/duplicate", a.token, { sourceEventId: other.id }, 403);
    await call(
      "events/delete",
      a.token,
      { eventId: cloned.id, orgId: orgB },
      403,
    );
    await call("events/delete", b.token, { eventId: cloned.id }, 403);
    await call("events/delete", a.token, { eventId: cloned.id });
    await call("events/detail", a.token, { eventId: cloned.id }, 404);
    const overview = eventsOverviewSchema.parse(
      await call("events/overview", a.token, { orgId: orgA }),
    );
    assertEquals(overview.events.map((row) => row.event.id), [event.id]);
    if (
      ["products", "forms", "b2"].includes(required("LOCAL_ORGANIZER_STAGE"))
    ) {
      const zero = eventProductSchema.parse(
        await call("events/products/create", a.token, {
          eventId: event.id,
          name: "Zero finite stock",
          priceCents: 0,
          stockQty: 0,
          createsAttendees: false,
          attendeesPerUnit: 2,
        }),
      );
      assertEquals(zero.stockQty, 0);
      assertEquals(zero.createsAttendees, false);
      assertEquals(zero.reservedQty, 0);
      assertEquals(zero.soldQty, 0);
      const paid = eventProductSchema.parse(
        await call("events/products/update", a.token, {
          productId: zero.id,
          patch: { stockQty: null, priceCents: 250, currency: "eur" },
        }),
      );
      assertEquals(paid.stockQty, null);
      assertEquals(paid.currency, "EUR");
      const read = eventProductSchema.parse(
        await call("events/products/read", admin.token, { productId: zero.id }),
      );
      assertEquals(read.id, zero.id);
      assertEquals(read.priceCents, 250);
      await call("events/products/read", b.token, { productId: zero.id }, 403);
      await call("events/products/create", a.token, {
        eventId: other.id,
        name: "Foreign",
        priceCents: 0,
      }, 403);
      await call("events/products/update", a.token, {
        productId: zero.id,
        patch: { soldQty: 900 },
      }, 400);
      await call("events/products/update", a.token, {
        productId: zero.id,
        patch: { eventId: other.id },
      }, 400);
      await call("events/products/update", a.token, {
        productId: zero.id,
        patch: { currency: "USD" },
      }, 400);
      assert(
        !(await service.from("event_products").update({
          stock_qty: 6,
          reserved_qty: 2,
          sold_qty: 1,
        }).eq("id", zero.id)).error,
      );
      await call("events/products/update", a.token, {
        productId: zero.id,
        patch: { stockQty: 0 },
      }, 409);
      const bounded = eventProductSchema.parse(
        await call("events/products/update", a.token, {
          productId: zero.id,
          patch: { stockQty: 3 },
        }),
      );
      assertEquals(bounded.stockQty, 3);
      assertEquals(bounded.reservedQty, 2);
      assertEquals(bounded.soldQty, 1);
      await call("events/products/delete", b.token, { id: zero.id }, 403);
      await call("events/products/delete", a.token, { id: zero.id });
      await call("events/products/read", a.token, { productId: zero.id }, 404);
      assertEquals(
        (await a.client.from("event_products").select("*")).error?.code,
        "42501",
      );
      for (
        const [name, args] of [
          ["create_event_product", {
            p_input: { event_id: event.id, name: "Forged", price_cents: 0 },
          }],
          ["update_event_product", {
            p_input: { product_id: zero.id, name: "Forged" },
          }],
          ["organizer_create_event_product", {
            p_actor_id: a.id,
            p_input: {
              org_id: orgA,
              event_id: event.id,
              name: "Forged",
              price_cents: 0,
            },
          }],
        ] satisfies [string, Record<string, unknown>][]
      ) {
        assert(
          (await a.client.rpc(name, args)).error,
          `Browser RPC ${name} open`,
        );
      }
    }
    if (["forms", "b2"].includes(required("LOCAL_ORGANIZER_STAGE"))) {
      const group = eventFormFieldGroupSchema.parse(
        await call("events/forms/groups/create", a.token, {
          eventId: event.id,
          label: "Extra group",
          description: null,
          sortOrder: 20,
          isActive: true,
        }),
      );
      const foreignGroup = eventFormFieldGroupSchema.parse(
        await call("events/forms/groups/create", b.token, {
          eventId: other.id,
          label: "Foreign group",
          description: null,
          sortOrder: 20,
          isActive: true,
        }),
      );
      const options = ["  Camel_Snake RAW  "];
      const fieldInput = {
        eventId: event.id,
        groupId: group.id,
        label: "Choice field",
        fieldKey: "choice_field",
        fieldType: "select",
        isRequired: false,
        isActive: true,
        sortOrder: 21,
        options,
      };
      const field = eventFormFieldSchema.parse(
        await call("events/forms/fields/create", a.token, fieldInput),
      );
      assertEquals(field.options, options);
      const legacyOptions = [{
        label: "  Label_Snake  ",
        value: "  CamelValue_RAW  ",
      }];
      const legacy = eventFormFieldSchema.parse(
        await call("events/forms/fields/create", a.token, {
          ...fieldInput,
          label: "Legacy choice",
          fieldKey: "legacy_choice",
          sortOrder: 22,
          options: legacyOptions,
        }),
      );
      assertEquals(legacy.options, legacyOptions);
      const renamed = eventFormFieldSchema.parse(
        await call("events/forms/fields/update", admin.token, {
          fieldId: field.id,
          patch: { label: "Renamed choice" },
        }),
      );
      assertEquals(renamed.options, options);
      assertEquals(
        eventFormFieldSchema.parse(
          await call("events/forms/fields/read", a.token, {
            fieldId: legacy.id,
          }),
        ).options,
        legacyOptions,
      );
      await call(
        "events/forms/fields/read",
        b.token,
        { fieldId: field.id },
        403,
      );
      await call("events/forms/fields/create", a.token, {
        ...fieldInput,
        fieldKey: "foreign_group",
        groupId: foreignGroup.id,
      }, 400);
      await call("events/forms/fields/update", a.token, {
        fieldId: field.id,
        patch: { groupId: foreignGroup.id },
      }, 400);
      await call("events/forms/fields/update", a.token, {
        fieldId: field.id,
        patch: { eventId: other.id },
      }, 400);
      const otherDetail = eventDetailAdminCoreSchema.parse(
        await call("events/detail", b.token, { eventId: other.id }),
      );
      await call("events/forms/reorder", a.token, {
        eventId: event.id,
        fields: [{ id: field.id, sortOrder: 22 }, {
          id: otherDetail.formFields[0].id,
          sortOrder: 21,
        }],
      }, 400);
      assertEquals(
        eventFormFieldSchema.parse(
          await call("events/forms/fields/read", a.token, {
            fieldId: field.id,
          }),
        ).sortOrder,
        21,
      );
      await call("events/forms/reorder", a.token, {
        eventId: event.id,
        fields: [{ id: field.id, sortOrder: 22 }, {
          id: legacy.id,
          sortOrder: 21,
        }],
        groups: [{ id: group.id, sortOrder: 25 }],
      });
      assertEquals(
        eventFormFieldSchema.parse(
          await call("events/forms/fields/read", a.token, {
            fieldId: field.id,
          }),
        ).sortOrder,
        22,
      );
      const groupRead = eventFormFieldGroupSchema.parse(
        await call("events/forms/groups/read", a.token, { groupId: group.id }),
      );
      assertEquals(groupRead.sortOrder, 25);
      const groupUpdated = eventFormFieldGroupSchema.parse(
        await call("events/forms/groups/update", a.token, {
          groupId: group.id,
          patch: { description: "Preserved group description" },
        }),
      );
      assertEquals(groupUpdated.description, "Preserved group description");
      await call("events/forms/groups/delete", b.token, { id: group.id }, 403);
      await call("events/forms/groups/delete", a.token, { id: group.id });
      const surviving = eventFormFieldSchema.parse(
        await call("events/forms/fields/read", a.token, { fieldId: field.id }),
      );
      assertEquals(surviving.groupId, null);
      assertEquals(surviving.options, options);
      await call("events/forms/fields/delete", b.token, { id: field.id }, 403);
      await call("events/forms/fields/delete", a.token, { id: field.id });
      await call(
        "events/forms/fields/read",
        a.token,
        { fieldId: field.id },
        404,
      );
      for (const table of ["event_form_fields", "event_form_field_groups"]) {
        assertEquals(
          (await a.client.from(table).select("*")).error?.code,
          "42501",
        );
      }
      for (
        const name of [
          "create_event_form_field",
          "create_event_form_field_group",
        ]
      ) {
        assert(
          (await a.client.rpc(name, {
            p_input: { event_id: event.id, label: "Forged" },
          })).error,
          `Browser RPC ${name} open`,
        );
      }
    }
    if (required("LOCAL_ORGANIZER_STAGE") === "b2") {
      const input = {
        orgId: orgA,
        eventId: event.id,
        code: "  Mixed_Code  ",
        discountPercent: 10,
        discountCents: null,
        maxUses: 5,
        startsAt: new Date(Date.now() + 10 * 86400000).toISOString(),
        endsAt: new Date(Date.now() + 20 * 86400000).toISOString(),
      };
      await call("events/promos/list", null, { eventId: event.id }, 401);
      await call("events/promos/list", "invalid-synthetic-session", {
        eventId: event.id,
      }, 401);
      await call(
        "events/promos/create",
        a.token,
        { ...input, orgId: orgB },
        403,
      );
      await call("events/promos/create", a.token, {
        ...input,
        eventId: other.id,
      }, 403);
      await call(
        "events/promos/create",
        a.token,
        { ...input, usedCount: 3 },
        400,
      );
      const promo = promoCodeSchema.parse(
        await call("events/promos/create", a.token, input),
      );
      assertEquals(promo.code, "MIXED_CODE");
      assertEquals(promo.usedCount, 0);
      const foreignPromo = promoCodeSchema.parse(
        await call("events/promos/create", b.token, {
          ...input,
          orgId: orgB,
          eventId: other.id,
        }),
      );
      await call("events/promos/create", a.token, {
        ...input,
        code: "mixed_code",
      }, 409);
      for (const route of ["read", "update", "delete"]) {
        await call(
          `events/promos/${route}`,
          a.token,
          route === "delete" ? { id: foreignPromo.id } : {
            promoCodeId: foreignPromo.id,
            ...(route === "update" ? { patch: { isActive: false } } : {}),
          },
          403,
        );
      }
      await call("events/promos/list", a.token, { eventId: other.id }, 403);
      await call("events/promos/update", a.token, {
        promoCodeId: promo.id,
        patch: { usedCount: 99 },
      }, 400);
      await call("events/promos/update", a.token, {
        promoCodeId: promo.id,
        patch: { orgId: orgB },
      }, 400);
      await call("events/promos/update", a.token, {
        promoCodeId: promo.id,
        patch: { endsAt: new Date(Date.now() + 5 * 86400000).toISOString() },
      }, 400);
      assertEquals(
        promoCodeSchema.parse(
          await call("events/promos/read", a.token, { promoCodeId: promo.id }),
        ).endsAt,
        promo.endsAt,
      );
      assert(
        !(await service.from("promo_codes").update({ used_count: 3 }).eq(
          "id",
          promo.id,
        )).error,
      );
      const changed = promoCodeSchema.parse(
        await call("events/promos/update", admin.token, {
          promoCodeId: promo.id,
          patch: {
            discountPercent: null,
            discountCents: 250,
            maxUses: 2,
            startsAt: null,
          },
        }),
      );
      assertEquals(changed.usedCount, 3);
      assertEquals(changed.maxUses, 2);
      assertEquals(changed.discountPercent, null);
      assertEquals(changed.discountCents, 250);
      assertEquals(changed.startsAt, null);
      assertEquals(changed.endsAt, promo.endsAt);
      assertEquals(changed.updatedAt, promo.updatedAt);
      const inconsistent = await service.from("promo_codes").insert({
        org_id: orgB,
        event_id: event.id,
        code: "LEGACY_RELATION",
        discount_percent: 5,
      }).select("id").single();
      assert(!inconsistent.error);
      const inconsistentId =
        z.object({ id: z.uuid() }).parse(inconsistent.data).id;
      await call(
        "events/promos/read",
        a.token,
        { promoCodeId: inconsistentId },
        409,
      );
      await call("events/promos/update", a.token, {
        promoCodeId: inconsistentId,
        patch: { isActive: false },
      }, 409);
      await call("events/promos/delete", a.token, { id: inconsistentId }, 409);
      await call("events/delete", a.token, { eventId: event.id }, 409);
      const listed = z.array(promoCodeSchema).parse(
        await call("events/promos/list", a.token, { eventId: event.id }),
      );
      assertEquals(listed.map((row) => row.id), [promo.id]);
      assert(
        !(await service.from("promo_codes").delete().eq("id", inconsistentId))
          .error,
      );
      // Admin CRUD may still manage an expired promotion. Checkout validity is
      // exercised with the real SQL function in the database recipes.
      const expired = promoCodeSchema.parse(
        await call("events/promos/create", a.token, {
          ...input,
          code: "EXPIRED_FIXTURE",
          startsAt: new Date(Date.now() - 2 * 86400000).toISOString(),
          endsAt: new Date(Date.now() - 86400000).toISOString(),
        }),
      );
      await call("events/promos/delete", a.token, { id: expired.id });
      await call(
        "events/promos/read",
        a.token,
        { promoCodeId: expired.id },
        404,
      );
      assertEquals(
        (await a.client.from("promo_codes").select("code")).error?.code,
        "42501",
      );
      assertEquals(
        (await a.client.from("promo_codes").update({ used_count: 0 }).eq(
          "id",
          promo.id,
        )).error?.code,
        "42501",
      );
      assert(
        (await a.client.rpc("organizer_update_event_promo_code", {
          p_actor_id: a.id,
          p_input: {
            org_id: orgA,
            event_id: event.id,
            promo_code_id: promo.id,
            used_count: 0,
          },
        })).error,
      );
    }
    const direct = await a.client.from("events").select("*");
    assertEquals(direct.error?.code, "42501");
    for (
      const [name, args] of [
        ["get_event_by_slug", { p_org_id: orgA, p_event_slug: updated.slug }],
        ["get_events_overview", { p_org_id: orgA }],
        ["get_event_detail_admin_core", { p_event_id: event.id }],
        ["create_event", { p_input: { org_id: orgA, title: "Forged" } }],
        ["update_event", { p_input: { event_id: event.id, title: "Forged" } }],
        ["duplicate_event", { p_input: { source_event_id: event.id } }],
        ["organizer_create_event", {
          p_actor_id: a.id,
          p_input: { org_id: orgA, title: "Forged" },
        }],
      ] satisfies [string, Record<string, unknown>][]
    ) {
      const result = await a.client.rpc(name, args);
      assert(result.error, `Browser RPC ${name} open`);
      assert(["42501", "PGRST202"].includes(result.error.code));
    }
  } finally {
    await server.shutdown();
    for (const orgId of orgs) {
      assert(
        !(await service.from("organizations").delete().eq("id", orgId)).error,
      );
    }
    for (const userId of users) {
      assert(!(await service.auth.admin.deleteUser(userId)).error);
    }
  }
});
