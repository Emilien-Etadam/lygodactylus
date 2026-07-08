// Check if running in Electron
export const isElectron =
  typeof window !== 'undefined' && window.electronAPI !== undefined;
