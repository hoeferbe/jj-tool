import type { CapacitorConfig } from '@capacitor/cli';

// Android build reads the app's compiled dist/ output; the API base URL for a device build
// must point at the reachable server address, not localhost (see apps/app/.env for VITE_API_URL).
const config: CapacitorConfig = {
  appId: 'de.jjtool.jagdrevier',
  appName: 'Mein Jagdrevier',
  webDir: 'dist',
};

export default config;
