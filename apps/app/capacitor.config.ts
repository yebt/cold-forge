import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Android package / iOS bundle id. Changing it after the first public APK breaks updates in place.
  appId: "work.coldforge.app",
  appName: "COLD FORGE",
  webDir: "dist",
  backgroundColor: "#070b12",
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
