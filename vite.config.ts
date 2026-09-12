import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite supplies a fast local server and creates the optimized production build.
export default defineConfig({
  plugins: [react()],
});
