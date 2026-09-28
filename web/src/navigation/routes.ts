export type AppRoute = "assets" | "send" | "swap" | "liquidity" | "activity";

const routes = new Set<AppRoute>(["assets", "send", "swap", "liquidity", "activity"]);

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
  return segment && routes.has(segment as AppRoute) ? segment as AppRoute : "assets";
}

export function pathForRoute(route: AppRoute, baseUrl: string): string {
  const basePath = normalizedBasePath(baseUrl);
  return route === "assets" ? `${basePath}/` || "/" : `${basePath}/${route}`;
}
