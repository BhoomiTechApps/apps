// modules/ime/ime.js
import { transliterate } from "./transliterator.js";

/**
 * Attaches the IME logic to a textarea.
 * @param {HTMLTextAreaElement} textarea - The input element.
 * @param {Function} onUpdate - Callback returning (romanBuffer, transliteratedText).
 */
export function attachPhoneticIME(textarea, onUpdate) {
    if (!textarea) return;

    textarea.addEventListener("input", () => {
        const buffer = textarea.value;
        
        // The transliterator now handles fusions (Step 4) 
        // and broken ligatures (Step 5) automatically.
        const transliteratedText = transliterate(buffer);

        if (onUpdate) {
            onUpdate(buffer, transliteratedText);
        }
    });
}