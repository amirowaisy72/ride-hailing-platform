// Shared by the server layout and the client ThemeProvider (no "use client").
export const THEME_STORAGE_KEY = "app-theme-preference";
export const THEME_OPTIONS = ["system", "light", "dark"];

/**
 * Inline script placed in <head>. Runs before first paint so the page never
 * flashes the wrong theme (works for static export and Capacitor WebViews).
 */
export const themeBootScript = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var p=localStorage.getItem(k);if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.dataset.theme=d?"dark":"light";r.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
