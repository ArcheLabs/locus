export function networkConfigPath(baseUrl: string): string {
  return publicPath("locus-networks.json", baseUrl);
}

export function assetCatalogPath(networkId: string, baseUrl: string): string {
  return publicPath(`catalogs/${networkId}.json`, baseUrl);
}

export function networkDeploymentPath(deploymentUrl: string, baseUrl: string): string {
  if (deploymentUrl.startsWith("//")) return deploymentUrl;
  if (/^[a-z][a-z0-9+.-]*:/i.test(deploymentUrl)) {
    if (!/^https:\/\//i.test(deploymentUrl)) throw new Error("deployment URL must use HTTPS");
    return deploymentUrl;
  }
  return publicPath(deploymentUrl, baseUrl);
}

function publicPath(path: string, baseUrl: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${path.replace(/^\/+/, "")}`;
}
