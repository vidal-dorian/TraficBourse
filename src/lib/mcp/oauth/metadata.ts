// Discovery documents: RFC 9728 (protected resource) and RFC 8414 (authorization server).
import { getPublicUrl, jsonResponse, notConfigured, resourceUrl } from "./config";

/** GET /.well-known/oauth-protected-resource[/api/mcp] */
export function protectedResourceMetadata(): Response {
  const publicUrl = getPublicUrl();
  if (!publicUrl) return notConfigured();
  return jsonResponse({
    resource: resourceUrl(publicUrl),
    authorization_servers: [publicUrl],
    bearer_methods_supported: ["header"],
  });
}

/** GET /.well-known/oauth-authorization-server */
export function authorizationServerMetadata(): Response {
  const publicUrl = getPublicUrl();
  if (!publicUrl) return notConfigured();
  return jsonResponse({
    issuer: publicUrl,
    authorization_endpoint: `${publicUrl}/oauth/authorize`,
    token_endpoint: `${publicUrl}/oauth/token`,
    registration_endpoint: `${publicUrl}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}
