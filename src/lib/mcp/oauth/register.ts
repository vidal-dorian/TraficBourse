// Dynamic client registration (RFC 7591) of public clients, limited to an allowlist of redirect URIs.
import { z } from "zod";
import { getAllowedRedirectUris, getPublicUrl, jsonResponse, notConfigured, readBoundedText } from "./config";
import { createClient } from "./store";

const GRANT_TYPES = ["authorization_code", "refresh_token"] as const;

const Metadata = z.object({
  redirect_uris: z.array(z.string().max(2048)).min(1).max(10),
  client_name: z.string().trim().max(200).optional(),
  // Whatever is asked, the client is public: the answer says "none" (RFC 7591 §3.2.1).
  token_endpoint_auth_method: z.string().max(100).optional(),
  grant_types: z.array(z.enum(GRANT_TYPES)).optional(),
  response_types: z.array(z.literal("code")).optional(),
});

function registrationError(error: "invalid_client_metadata" | "invalid_redirect_uri", description: string): Response {
  return jsonResponse({ error, error_description: description }, 400);
}

/** POST /oauth/register */
export async function registerClient(request: Request): Promise<Response> {
  if (!getPublicUrl()) return notConfigured();

  let body: unknown;
  try {
    const text = await readBoundedText(request);
    if (text === undefined) return jsonResponse({ error: "invalid_client_metadata", error_description: "Request body too large." }, 413);
    body = JSON.parse(text);
  } catch {
    return registrationError("invalid_client_metadata", "The body must be JSON.");
  }

  const parsed = Metadata.safeParse(body);
  if (!parsed.success) return registrationError("invalid_client_metadata", "Invalid client metadata.");

  const allowed = getAllowedRedirectUris();
  if (!parsed.data.redirect_uris.every((uri) => allowed.includes(uri))) {
    return registrationError("invalid_redirect_uri", "A redirect URI is not allowed.");
  }

  const client = createClient(parsed.data.redirect_uris, parsed.data.client_name || null);
  return jsonResponse(
    {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: client.redirectUris,
      ...(client.clientName ? { client_name: client.clientName } : {}),
      token_endpoint_auth_method: "none",
      grant_types: [...GRANT_TYPES],
      response_types: ["code"],
    },
    201,
  );
}
