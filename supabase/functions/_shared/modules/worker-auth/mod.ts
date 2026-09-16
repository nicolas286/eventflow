export class WorkerAuthenticationError extends Error {
  constructor() {
    super("Invalid worker authentication");
    this.name = "WorkerAuthenticationError";
  }
}

function bearerToken(authorization: string | null): string {
  const match = authorization?.trim().match(/^Bearer[\t ]+([^\s]+)$/iu);
  if (!match) throw new WorkerAuthenticationError();
  return match[1];
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

export async function assertWorkerToken(
  providedToken: string,
  expectedToken: string,
): Promise<void> {
  if (!expectedToken) throw new WorkerAuthenticationError();

  const [provided, expected] = await Promise.all([
    digest(providedToken),
    digest(expectedToken),
  ]);

  let difference = provided.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= (provided[index] ?? 0) ^ expected[index];
  }

  if (difference !== 0) throw new WorkerAuthenticationError();
}

export async function assertWorkerAuthentication(
  req: Request,
  expectedToken: string,
): Promise<void> {
  await assertWorkerToken(
    bearerToken(req.headers.get("authorization")),
    expectedToken,
  );
}
