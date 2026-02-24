import { transliterate } from '../../modules/ime/transliterator.js';
import { reverseTransliterate } from '../../modules/ime/reverse.js';

// 1. Element Selectors
const inputArea = document.getElementById('input');
const reverseArea = document.getElementById('reverseOutput');
const saveBtn = document.getElementById('saveBtn');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const helpBtn = document.getElementById("helpBtn");
const helpModal = document.getElementById("helpModal");
const closeHelpModal = document.getElementById("closeHelpModal");
const helpContainer = document.getElementById("helpContainer");

// 2. Transliteration & Reverse View Logic
inputArea.addEventListener('input', (e) => {
    const text = inputArea.value;
    const cursorPos = inputArea.selectionStart;
    const lastChar = text[cursorPos - 1];

    // --- A. Word-by-Word Transliteration ---
    // Trigger conversion when user types a space or punctuation
    const isDelimiter = /\s|[.,!?;:]/.test(lastChar);
    
    if (isDelimiter) {
        // Split text into tokens (words, spaces, symbols)
        const tokens = text.match(/(\S+|\s+|[.,!?;:])/g) || [];
        let currentPos = 0;
        let lastWordIndex = -1;

        // Find the word exactly before the cursor
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (currentPos + token.length <= cursorPos) {
                // Check if token is actually a word (not just whitespace/punctuation)
                if (!/^\s*$/.test(token) && !/^[.,!?;:]$/.test(token)) {
                    lastWordIndex = i;
                }
            }
            currentPos += token.length;
        }

        if (lastWordIndex !== -1) {
            const lastWord = tokens[lastWordIndex];
            // Fuses if in conjunctionRules, breaks if not
            const converted = transliterate(lastWord);
            
            if (converted !== lastWord) {
                tokens[lastWordIndex] = converted;
                inputArea.value = tokens.join('');
                // Restore cursor position
                inputArea.selectionStart = inputArea.selectionEnd = cursorPos;
            }
        }
    }

    // --- B. Real-time Reverse View Update ---
    if (reverseArea) {
    // DO NOT transliterate again here. Just reverse what is currently in the box.
    // If it's Bengali, it reverses. If it's Roman (typing), it stays Roman or reverses partially.
        reverseArea.value = reverseTransliterate(inputArea.value);
    }
});

// 3. Button Actions
saveBtn.addEventListener('click', () => {
    localStorage.setItem('bishnupriya_doc', inputArea.value);
    alert('Document saved locally!');
});

exportBtn.addEventListener('click', () => {
    const blob = new Blob([inputArea.value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bishnupriya_text.txt';
    a.click();
    URL.revokeObjectURL(url);
});

clearBtn.addEventListener('click', () => {
    if(confirm("Clear all text?")) {
        inputArea.value = '';
        if (reverseArea) reverseArea.value = '';
    }
});

// 4. Initialization & Help Modal
window.addEventListener('load', () => {
    const saved = localStorage.getItem('bishnupriya_doc');
    if (saved) inputArea.value = saved;
});

let helpLoaded = false;
helpBtn.addEventListener("click", async () => {
    helpModal.style.display = "flex";
    document.body.style.overflow = "hidden";
    if (!helpLoaded) {
        try {
            const response = await fetch("assets/help/map.html");
            const html = await response.text();
            helpContainer.innerHTML = html;
            helpLoaded = true;
        } catch {
            helpContainer.innerHTML = "<p>Failed to load help content.</p>";
        }
    }
});

const closeModal = () => {
    helpModal.style.display = "none";
    document.body.style.overflow = "";
};

closeHelpModal.addEventListener("click", closeModal);
helpModal.addEventListener("click", (e) => { if (e.target === helpModal) closeModal(); });