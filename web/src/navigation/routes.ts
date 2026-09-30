export type AppRoute = "assets" | "send" | "swap" | "liquidity" | "liquidity-new" | "activity";

const routes = new Set<AppRoute>(["assets", "send", "swap", "liquidity", "liquidity-new", "activity"]);

function normalizedBasePath(baseUrl: string): string {
  const value = baseUrl.startsWith("/") ? baseUrl : `/${baseUrl}`;
  const trimmed = value.replace(/\/+$/, "");
  return trimmed || "";
}

export function routeFromPath(pathname: string, baseUrl: string): AppRoute {
  const basePath = normalizedBasePath(baseUrl);
  let routePath = pathname;
  if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) {
    routePath = pathname.slice(basePath.length);
  }
  const segment = routePath.replace(/^\/+|\/+$/g, "");
  if (segment === "liquidity/new") return "liquidity-new";
  return segment && routes.has(segment as AppRoute) ? segment as AppRoute : "assets";
}

export function pathForRoute(route: AppRoute, baseUrl: string): string {
  const basePath = normalizedBasePath(baseUrl);
  if (route === "assets") return `${basePath}/` || "/";
  if (route === "liquidity-new") return `${basePath}/liquidity/new`;
  return `${basePath}/${route}`;
}
