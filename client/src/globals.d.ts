declare module "*.css";

declare module "*.js" {
  const url: string;
  export default url;
}

declare module "./map_helpers.mjs" {
  export interface PlaceRef {
    label: string;
    venue?: string;
    address?: string;
    locality?: string;
    region?: string;
    country?: string;
    lat?: number;
    lng?: number;
    source?: string;
  }
  export function mountMap(
    container: HTMLElement,
    options: Record<string, unknown>,
    onUnavailable: () => void,
  ): { selectPlace?: (index: number) => void } | null;
  export function mapsSearchUrl(place: PlaceRef): string | null;
  export function mapsDirectionsUrl(
    destination: PlaceRef,
    options?: { origin?: { lat: number; lng: number }; travelmode?: string },
  ): string | null;
}
