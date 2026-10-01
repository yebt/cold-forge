import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.coldforge",
  appName: "COLD FORGE",
  webDir: "dist",
  backgroundColor: "#070b12",
  plugins: {
    LocalNotifications: {
      iconColor: "#7DD3FC",
    },
  },
};

export default config;
