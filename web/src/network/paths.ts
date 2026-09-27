export function networkConfigPath(baseUrl: string): string {
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}locus-networks.json`;
}
