import { assertEquals } from "@std/assert";
import { handleGetInvoicePdfUrl } from "../invoices/handler.ts";
import type {
  InvoicePdfRecord,
  InvoicePdfUrlRepository,
  RepositoryResult,
} from "../invoices/repository.ts";

function result<T>(data: T): RepositoryResult<T> {
  return { data, errorMessage: null };
}

function repository(
  overrides: Partial<InvoicePdfUrlRepository> = {},
): InvoicePdfUrlRepository {
  const invoice: InvoicePdfRecord = {
    id: "11111111-1111-4111-8111-111111111111",
    orgId: "22222222-2222-4222-8222-222222222222",
    pdfPath: "org/invoice.pdf",
  };

  return {
    loadInvoice: () => Promise.resolve(result(invoice)),
    isOrganizationMember: () => Promise.resolve(result(true)),
    createSignedUrl: () => Promise.resolve(result("https://storage.example/signed")),
    ...overrides,
  };
}

async function invoke(
  body: unknown,
  currentRepository = repository(),
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const req = new Request(
    `https://edge.test/invoices/${
      (body as { invoice_id: string }).invoice_id
    }/pdf`,
    {
      method: "GET",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:5173",
      },
    },
  );
  const response = await handleGetInvoicePdfUrl({
    req,
    repository: currentRepository,
  });

  return {
    response,
    body: await response.json() as Record<string, unknown>,
  };
}

Deno.test("invoice PDF handler preserves the successful response contract", async () => {
  const { response, body } = await invoke({
    invoice_id: "11111111-1111-4111-8111-111111111111",
  });

  assertEquals(response.status, 200);
  assertEquals(body, {
    url: "https://storage.example/signed",
    expiresIn: 120,
  });
});

Deno.test("invoice PDF handler rejects invalid identifiers", async () => {
  const { response, body } = await invoke({ invoice_id: "not-a-uuid" });
  assertEquals(response.status, 400);
  assertEquals(body, { error: "invoice_id invalid" });
});

Deno.test("invoice PDF handler refuses another organization", async () => {
  const { response, body } = await invoke(
    { invoice_id: "11111111-1111-4111-8111-111111111111" },
    repository({ isOrganizationMember: () => Promise.resolve(result(false)) }),
  );

  assertEquals(response.status, 403);
  assertEquals(body, { error: "FORBIDDEN" });
});

Deno.test("invoice PDF handler preserves not-ready and signing failures", async () => {
  const notReady = await invoke(
    { invoice_id: "11111111-1111-4111-8111-111111111111" },
    repository({
      loadInvoice: () => Promise.resolve(result({
          id: "11111111-1111-4111-8111-111111111111",
          orgId: "22222222-2222-4222-8222-222222222222",
          pdfPath: null,
        })),
    }),
  );
  const signFailure = await invoke(
    { invoice_id: "11111111-1111-4111-8111-111111111111" },
    repository({ createSignedUrl: () => Promise.resolve(result(null)) }),
  );

  assertEquals(notReady.response.status, 409);
  assertEquals(notReady.body, { error: "PDF_NOT_READY" });
  assertEquals(signFailure.response.status, 500);
  assertEquals(signFailure.body, {
    error: "SIGN_FAILED",
    details: "no_signed_url",
  });
});
