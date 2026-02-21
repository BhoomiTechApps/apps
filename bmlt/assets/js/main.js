import { transliterate } from '../../modules/ime/transliterator.js';

const inputArea = document.getElementById('input');
const saveBtn = document.getElementById('saveBtn');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');

inputArea.addEventListener('input', () => {
  const cursorPos = inputArea.selectionStart;
  const text = inputArea.value;

  const lastChar = text[cursorPos - 1];
  if (lastChar === ' ' || /[.,!?;:]/.test(lastChar)) {

    const regex = /(\S+|\s+|[.,!?;:])/g;
    let match;
    const tokens = [];
    let tokenEnd = 0;

    while ((match = regex.exec(text)) !== null) {
      tokens.push(match[0]);
      tokenEnd = regex.lastIndex;
    }

    let lastWordIndex = tokens.length - 2;
    while (lastWordIndex >= 0 && /^\s*$/.test(tokens[lastWordIndex] || '') || /^[.,!?;:]$/.test(tokens[lastWordIndex] || '')) {
      lastWordIndex--;
    }

    if (lastWordIndex >= 0) {
      const lastWord = tokens[lastWordIndex];
      const transliterated = transliterate(lastWord);
      tokens[lastWordIndex] = transliterated;

      const newText = tokens.join('');
      inputArea.value = newText;

      const charsUpToCursor = text.slice(0, cursorPos);
      let newCursor = transliterateCursorPosition(lastWordIndex, tokens, charsUpToCursor);
      inputArea.selectionStart = inputArea.selectionEnd = newCursor;
    }
  }
});

function transliterateCursorPosition(lastWordIndex, tokens, originalTextUpToCursor) {
  let charCount = 0;
  for (let i = 0; i <= lastWordIndex; i++) {
    charCount += tokens[i].length;
  }
  const remaining = originalTextUpToCursor.length - charCount;
  return charCount + Math.max(0, remaining);
}

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
  inputArea.value = '';
});

window.addEventListener('load', () => {
  const saved = localStorage.getItem('bishnupriya_doc');
  if (saved) inputArea.value = saved;
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js')
    .then(() => console.log('Service Worker registered'))
    .catch(err => console.error('SW registration failed:', err));
}

const helpBtn = document.getElementById("helpBtn");
const helpModal = document.getElementById("helpModal");
const closeHelpModal = document.getElementById("closeHelpModal");
const helpContainer = document.getElementById("helpContainer");

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

function closeModal() {
  helpModal.style.display = "none";
  document.body.style.overflow = "";
}

closeHelpModal.addEventListener("click", closeModal);

helpModal.addEventListener("click", (e) => {
  if (e.target === helpModal) {
    closeModal();
  }
});
