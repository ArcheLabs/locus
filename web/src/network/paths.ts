export function networkConfigPath(baseUrl: string): string {
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}locus-networks.json`;
}

export function assetCatalogPath(networkId: string, baseUrl: string): string {
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}catalogs/${networkId}.json`;
}
