/** @overload @param {"search" | "family-password"} id @returns {HTMLInputElement} */
/** @overload @param {"layout-down" | "layout-right" | "layout-list" | "password-toggle"} id @returns {HTMLButtonElement} */
/** @overload @param {string} id @returns {HTMLElement} */
/** @param {string} id */
export function byId(id) { return document.getElementById(id); }
