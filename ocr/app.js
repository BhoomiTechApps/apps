let pdfDoc = null;
let currentZoom = 1.0;
let currentFile = null;
let currentPage = 1;
let totalPages = 0;

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
});

async function handleFileSelect(input) {
  currentFile = input.files[0];
  updateFileName(input);
  if (!currentFile) return;
  if (currentFile.type === "application/pdf") {
    await loadPDF(currentFile);
  } else {
    document.querySelector('.pagination-controls').style.display = 'none';
    await processImage(currentFile);
  }
}

async function startOCR() {
  if (!currentFile) {
    alert("Please select a file first.");
    return;
  }
  await runTesseract();
}

async function loadPDF(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  pdfDoc = await pdfjsLib.getDocument({ data }).promise;
  totalPages = pdfDoc.numPages;
  currentPage = 1;
  document.getElementById("pageCount").innerText = totalPages;
  document.getElementById("pageJump").value = currentPage;
  document.querySelector('.pagination-controls').style.display = 'flex';
  updatePaginationButtons();
  await renderPage(currentPage);
}

async function renderPage(num) {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(num);
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const viewport = page.getViewport({ scale: currentZoom * 2 });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
}

async function changePage(delta) {
  const newPage = currentPage + delta;
  if (newPage >= 1 && newPage <= totalPages) {
    currentPage = newPage;
    document.getElementById("pageJump").value = currentPage;
    updatePaginationButtons();
    await renderPage(currentPage);
  }
}

async function jumpToPage() {
  const jumpInput = document.getElementById("pageJump");
  let val = parseInt(jumpInput.value);
  if (val >= 1 && val <= totalPages) {
    currentPage = val;
    updatePaginationButtons();
    await renderPage(currentPage); 
  } else {
    jumpInput.value = currentPage; 
  }
}

function updatePaginationButtons() {
  document.getElementById("prevPage").disabled = (currentPage <= 1);
  document.getElementById("nextPage").disabled = (currentPage >= totalPages);
}

async function processImage(file) {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await new Promise((resolve) => {
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      resolve();
    };
  });
}

async function runTesseract() {
  const canvas = document.getElementById("canvas");
  const lang = document.getElementById("lang").value;
  const progressBar = document.getElementById("ocrProgress");
  const progressText = document.getElementById("progressText");
  progressBar.style.display = "inline-block";
  progressText.style.display = "inline-block";
  const result = await Tesseract.recognize(
    canvas,
    lang,
    {
      logger: m => {
        if (m.status === 'recognizing text') {
          const percentage = Math.round(m.progress * 100);
          progressBar.value = percentage;
          progressText.innerText = percentage + "%";
        }
      }
    }
  );
  document.getElementById("output").value = result.data.text;
  progressBar.value = 100;
  progressText.innerText = "Done!";
  setTimeout(() => {
    progressBar.style.display = "none";
    progressText.style.display = "none";
  }, 2000);
}

async function changeZoom(delta) {
  let newZoom = parseFloat((currentZoom + delta).toFixed(1));
  currentZoom = Math.max(0.5, Math.min(3, newZoom));
  document.getElementById("zoomLevel").innerText = Math.round(currentZoom * 100) + "%";
  const wrapper = document.getElementById('canvasWrapper');
  if (currentZoom > 1.0) {
    wrapper.classList.add('zoomed');
  } else {
    wrapper.classList.remove('zoomed');
  }
  if (pdfDoc) {
    await renderPage(currentPage);
  } else if (currentFile) {
    await processImage(currentFile);
  }
}

function copyText() {
  const text = document.getElementById("output").value;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.icon-btn i[data-lucide="copy"]');
    if(btn) {
        btn.parentElement.innerHTML = '<i data-lucide="check"></i>';
        lucide.createIcons();
        setTimeout(() => {
            const btnContainer = document.querySelector('.right-panel .icon-btn');
            btnContainer.innerHTML = '<i data-lucide="copy"></i>';
            lucide.createIcons();
        }, 2000);
    }
  });
}

function updateFileName(input) {
  const display = document.getElementById('fileNameDisplay');
  display.innerText = input.files[0] ? input.files[0].name : "No file chosen";
}