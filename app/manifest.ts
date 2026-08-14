import type { MetadataRoute } from "next";
import { PROJECT } from "@/lib/project";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PROJECT.name,
    short_name: PROJECT.name,
    description: "Local-first SWM100 air-conditioner control.",
    start_url: "/",
    display: "standalone",
    background_color: "#071310",
    theme_color: "#071310",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
