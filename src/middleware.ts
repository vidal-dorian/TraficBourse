import { NextResponse, type NextRequest } from "next/server";
import { isAdminAuthDisabled, readAccessConfig, verifyAccessToken } from "@/lib/auth/cloudflare-access";

// Only the admin pages go through the Access check: public pages and /api/* never do.
export const config = {
  matcher: ["/admin", "/admin/:path*"],
};

// Same short answer whatever the reason: the details stay in the server logs.
function deny(): NextResponse {
  return new NextResponse("Accès refusé.", {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Lets /admin through only with a valid Cloudflare Access token for an admin e-mail. */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const env = process.env;

  if (isAdminAuthDisabled(env)) return NextResponse.next();
  if (env.ADMIN_AUTH_DISABLED === "true") {
    console.warn("ADMIN_AUTH_DISABLED is ignored in production: the Access check stays on");
  }

  const accessConfig = readAccessConfig(env);
  if (!accessConfig.ok) {
    // Fail closed: without a complete config nobody gets in.
    console.error(`Admin access refused: invalid Access config (${accessConfig.problems.join("; ")})`);
    return deny();
  }

  const result = await verifyAccessToken(request.headers.get("cf-access-jwt-assertion"), accessConfig.config);
  if (!result.ok) {
    if (result.reason === "keys_unavailable") {
      console.error("Admin access refused: the Cloudflare Access keys could not be fetched");
    }
    return deny();
  }

  return NextResponse.next();
}
