import { transliterate } from '../../modules/ime/transliterator.js';
import { reverseTransliterate } from '../../modules/ime/reverse.js';

const inputArea = document.getElementById('input');
const reverseArea = document.getElementById('reverseOutput');
const saveBtn = document.getElementById('saveBtn');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const helpBtn = document.getElementById("helpBtn");
const helpModal = document.getElementById("helpModal");
const closeHelpModal = document.getElementById("closeHelpModal");
const helpContainer = document.getElementById("helpContainer");

inputArea.addEventListener('input', (e) => {
    const text = inputArea.value;
    const cursorPos = inputArea.selectionStart;
    const lastChar = text[cursorPos - 1];

    const isDelimiter = /\s|[.,!?;:]/.test(lastChar);
    
    if (isDelimiter) {

        const tokens = text.match(/(\S+|\s+|[.,!?;:])/g) || [];
        let currentPos = 0;
        let lastWordIndex = -1;

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (currentPos + token.length <= cursorPos) {

                if (!/^\s*$/.test(token) && !/^[.,!?;:]$/.test(token)) {
                    lastWordIndex = i;
                }
            }
            currentPos += token.length;
        }

        if (lastWordIndex !== -1) {
            const lastWord = tokens[lastWordIndex];

            const converted = transliterate(lastWord);
            
            if (converted !== lastWord) {
                tokens[lastWordIndex] = converted;
                inputArea.value = tokens.join('');

                inputArea.selectionStart = inputArea.selectionEnd = cursorPos;
            }
        }
    }

    if (reverseArea) {

        reverseArea.value = reverseTransliterate(inputArea.value);
    }
});

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
