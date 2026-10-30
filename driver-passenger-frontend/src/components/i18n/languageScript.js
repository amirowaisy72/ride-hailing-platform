// Shared by the server layout and the client LanguageProvider (no "use client").
export const LANGUAGE_STORAGE_KEY = "app-language";
export const LANGUAGE_OPTIONS = ["en", "ur"];

/**
 * Inline script placed in <head>. Runs before first paint so an Urdu
 * user's app never flashes LTR/English chrome (works for static
 * export and Capacitor WebViews). Mirrors themeScript.js.
 */
export const languageBootScript = `(function(){try{var k=${JSON.stringify(LANGUAGE_STORAGE_KEY)};var p=localStorage.getItem(k);if(p!=="ur")p="en";var r=document.documentElement;if(p==="ur"){r.lang="ur";r.dir="rtl";r.classList.add("lang-ur");}else{r.lang="en";r.dir="ltr";r.classList.remove("lang-ur");}}catch(e){}})();`;
