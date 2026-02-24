// modules/ime/ime.js
import { transliterate } from "./transliterator.js";

export function attachPhoneticIME(textarea, onUpdate) {
    if (!textarea) return;

    textarea.addEventListener("input", () => {
        const buffer = textarea.value;
        
        const transliteratedText = transliterate(buffer);

        if (onUpdate) {
            onUpdate(buffer, transliteratedText);
        }
    });
}
