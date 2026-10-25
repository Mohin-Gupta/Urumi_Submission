import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // In dev, talk to the gateway running in the local cluster
  server: { proxy: { "/api": "http://app.127.0.0.1.nip.io" } },
});
