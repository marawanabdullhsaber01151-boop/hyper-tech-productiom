import type { Request } from "express";

const allowedSchemes = new Set(["http:", "https:"]);

/**
 * Validate and normalize the configured public origin.
 *
 * Development may omit the value and use the request origin as a local
 * fallback. Production must configure an HTTPS origin explicitly.
 */
export function validatePortalPublicUrl(
  value: string | undefined,
  environment = process.env.NODE_ENV,
): string | undefined {
  const configured = value?.trim();

  if (!configured) {
    if (environment === "production") {
      throw new Error(
        "PORTAL_PUBLIC_URL is required in production and must be an HTTPS origin",
      );
    }
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(
      "PORTAL_PUBLIC_URL must be a valid origin such as https://example.com",
    );
  }

  if (!allowedSchemes.has(parsed.protocol)) {
    throw new Error(
      "PORTAL_PUBLIC_URL must use http or https; other URL schemes are not allowed",
    );
  }

  if (
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      "PORTAL_PUBLIC_URL must contain only the origin, without a path, query, hash, or credentials",
    );
  }

  if (environment === "production" && parsed.protocol !== "https:") {
    throw new Error("PORTAL_PUBLIC_URL must use https in production");
  }

  return parsed.origin;
}

function requestOrigin(req: Request): string {
  return `${req.protocol}://${req.get("host") || "localhost"}`;
}

export function portalPublicBaseUrl(req: Request): string {
  return (
    validatePortalPublicUrl(
      process.env.PORTAL_PUBLIC_URL,
      process.env.NODE_ENV,
    ) || requestOrigin(req)
  );
}

export function buildPortalActivationUrl(
  req: Request,
  rawToken: string,
): string {
  const activationUrl = new URL(
    "/portal-activate.html",
    portalPublicBaseUrl(req),
  );
  activationUrl.searchParams.set("token", rawToken);
  return activationUrl.toString();
}

export function buildPortalPageUrl(req: Request, pathname: string): string {
  const pageUrl = new URL(
    pathname.startsWith("/") ? pathname : `/${pathname}`,
    portalPublicBaseUrl(req),
  );
  return pageUrl.toString();
}