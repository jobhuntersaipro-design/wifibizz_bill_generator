import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BizzFlow",
    short_name: "BizzFlow",
    description: "WifiBizz Crawler & Bill Generator",
    // "/" redirects to the dashboard or sign-in depending on the session,
    // so it is the right entry point either way.
    start_url: "/",
    display: "standalone",
    background_color: "#F6F9FC",
    theme_color: "#635BFF",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
