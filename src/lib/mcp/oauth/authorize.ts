// Authorization endpoint: a login page where the owner types the password, then a redirect
// back to the client with a single-use code (OAuth 2.1, PKCE S256 only).
import { tokensMatch } from "../auth";
import { getAllowedRedirectUris, getOwnerPassword, getPublicUrl, notConfigured, readBoundedText, resourceUrl } from "./config";
import { clientKey, isLockedOut, recordFailure, recordSuccess } from "./login-limiter";
import { findClient, issueCode } from "./store";

/** The parameters of an authorization request, carried by the login form in hidden fields. */
type AuthorizeRequest = {
  clientId: string;
  clientName: string | null;
  redirectUri: string;
  codeChallenge: string;
  state: string | undefined;
  resource: string | undefined;
};

const MAX_PARAM_LENGTH = 2048;
const PARAMS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "resource"];
const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  // The page holds a password field: never framed, no script, no external resource.
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  "Referrer-Policy": "no-referrer",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function page(title: string, body: string, status: number): Response {
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:24rem;margin:3rem auto;padding:0 1rem;color:#111}
label,input,button{display:block;width:100%;box-sizing:border-box;font:inherit}
input,button{margin-top:.5rem;padding:.6rem}
button{margin-top:1rem;cursor:pointer}
.error{color:#b00020}
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}

function errorPage(message: string, status = 400, headers: Record<string, string> = {}): Response {
  const response = page("Connexion impossible", `<p class="error">${escapeHtml(message)}</p>`, status);
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

function loginPage(request: AuthorizeRequest, status: number, error?: string): Response {
  const fields: Record<string, string | undefined> = {
    response_type: "code",
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    state: request.state,
    resource: request.resource,
  };
  const hidden = Object.entries(fields)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
    .join("\n");
  const application = request.clientName ? `L'application « ${escapeHtml(request.clientName)} »` : "Une application";
  const body = `${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
<p>${application} demande l'accès à votre veille boursière. Saisissez le mot de passe pour l'autoriser.</p>
<p><strong>Ne saisissez ce mot de passe que si vous venez d'ajouter le connecteur vous-même dans Claude.</strong></p>
<form method="post" action="/oauth/authorize">
${hidden}
<label for="password">Mot de passe</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Se connecter</button>
</form>`;
  return page("Connexion", body, status);
}

/** The request's parameters, or the message of the first problem (the client is then never redirected). */
function parseRequest(params: URLSearchParams, publicUrl: string): AuthorizeRequest | string {
  if (PARAMS.some((name) => (params.get(name) ?? "").length > MAX_PARAM_LENGTH)) return "Paramètre trop long.";
  const get = (name: string): string | undefined => params.get(name) ?? undefined;

  // Client and redirect URI first: until they are known good, nothing may be sent to the redirect URI.
  const client = findClient(get("client_id") ?? "");
  if (!client) return "Application inconnue.";
  const redirectUri = get("redirect_uri");
  // Registered for this client and still on the allowlist (which may have been narrowed since).
  if (!redirectUri || !client.redirectUris.includes(redirectUri) || !getAllowedRedirectUris().includes(redirectUri)) return "Adresse de retour non autorisée.";

  if (get("response_type") !== "code") return "Type de réponse non pris en charge.";
  const codeChallenge = get("code_challenge");
  if (!codeChallenge || !CODE_CHALLENGE.test(codeChallenge) || get("code_challenge_method") !== "S256") {
    return "PKCE (S256) obligatoire.";
  }
  const resource = get("resource");
  if (resource !== undefined && resource !== resourceUrl(publicUrl)) return "Ressource inconnue.";

  return { clientId: client.clientId, clientName: client.clientName, redirectUri, codeChallenge, state: get("state"), resource };
}

/** GET /oauth/authorize: the login page. */
export function showLogin(request: Request): Response {
  const publicUrl = getPublicUrl();
  if (!publicUrl) return notConfigured();

  const parsed = parseRequest(new URL(request.url).searchParams, publicUrl);
  return typeof parsed === "string" ? errorPage(parsed) : loginPage(parsed, 200);
}

/** POST /oauth/authorize: checks the password, then redirects with a code. */
export async function submitLogin(request: Request): Promise<Response> {
  const publicUrl = getPublicUrl();
  if (!publicUrl) return notConfigured();

  // Locked out: no parsing, no comparison, whatever the password.
  const client = clientKey(request);
  if (isLockedOut(client)) {
    return errorPage("Trop de tentatives. Réessayez dans quelques minutes.", 429, { "Retry-After": "900" });
  }

  const text = await readBoundedText(request).catch(() => undefined);
  if (text === undefined) return errorPage("Requête trop volumineuse.", 413);
  const params = new URLSearchParams(text);

  const parsed = parseRequest(params, publicUrl);
  if (typeof parsed === "string") return errorPage(parsed);

  const expected = getOwnerPassword();
  if (!expected) console.error("OAuth login refused: MCP_OAUTH_PASSWORD is not set");
  // Same answer for a wrong password and a missing configuration.
  if (!expected) return loginPage(parsed, 401, "Mot de passe incorrect.");
  // The body was awaited above: parallel requests may have used up the attempts meanwhile. This
  // check, the comparison and the failure count run with no await in between.
  if (isLockedOut(client)) {
    return errorPage("Trop de tentatives. Réessayez dans quelques minutes.", 429, { "Retry-After": "900" });
  }
  if (!tokensMatch(params.get("password") ?? "", expected)) {
    recordFailure(client);
    return loginPage(parsed, 401, "Mot de passe incorrect.");
  }
  recordSuccess(client);

  const code = issueCode({ clientId: parsed.clientId, redirectUri: parsed.redirectUri, codeChallenge: parsed.codeChallenge });
  const target = new URL(parsed.redirectUri);
  target.searchParams.set("code", code);
  // RFC 9207: tells the client which authorization server answered.
  target.searchParams.set("iss", publicUrl);
  if (parsed.state !== undefined) target.searchParams.set("state", parsed.state);
  return new Response(null, { status: 302, headers: { Location: target.toString(), "Cache-Control": "no-store" } });
}
