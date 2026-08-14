import packageMetadata from "../package.json" with { type: "json" };

/** Public identity lives in package.json so the UI, diagnostics and service agree. */
export const PROJECT = Object.freeze({
  name: packageMetadata.skyControl.displayName,
  slug: packageMetadata.skyControl.serviceSlug,
  serviceId: packageMetadata.skyControl.serviceId,
  version: packageMetadata.version,
  repositoryPackage: packageMetadata.name,
});

export const PROJECT_DISCLAIMER =
  "Unofficial community project; not affiliated with Skyworth, Tekno Point, Clima24, Easy Home or any other manufacturer.";
