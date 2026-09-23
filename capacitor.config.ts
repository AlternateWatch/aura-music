import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aura.music',
  appName: 'Aura',
  webDir: 'dist',

  plugins: {
   SystemBars: {
  insetsHandling: 'css',
  style: 'DARK',
  hidden: true,
  animation: 'NONE'
}
  }
};
export default config;