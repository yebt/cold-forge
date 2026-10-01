import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Android package / iOS bundle id. Changing it after the first public APK breaks updates in place.
  appId: "work.coldforge.app",
  appName: "COLD FORGE",
  webDir: "dist",
  backgroundColor: "#070b12",
  // Serve the bundled app from https://app.coldforge.work inside the WebView (still local files,
  // nothing is fetched from the network). Keeps the origin identical to the PWA, so the browser
  // API key and Firebase authorized domains never need to allow https://localhost.
  server: {
    hostname: "app.coldforge.work",
    androidScheme: "https",
  },
  plugins: {
    LocalNotifications: {
      iconColor: "#7DD3FC",
    },
    // Native Google account picker only; the Firebase JS SDK owns the session (src/firebase).
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ["google.com"],
    },
  },
};

export default config;
