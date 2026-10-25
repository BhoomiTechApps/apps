/**
 * export.js — Export to various formats (PDF, PNG, DOCX)
 * Handles: format conversion, file generation, output management
 */

const Export = (() => {
  "use strict";

  // Export to PDF (requires external library)
  function exportPDF(doc, filename = "document.pdf") {
    if (typeof html2pdf === "undefined") {
      alert("PDF export requires html2pdf library. Please load it.");
      return;
    }

    const element = document.getElementById("page-stage");
    
    // Determine orientation based on page dimensions
    const orientation = doc.pageH >= doc.pageW ? "portrait" : "landscape";
    
    // Convert mm to other units if needed
    // For jsPDF, we can use custom format with width and height
    const opt = {
      margin: 0,
      filename: filename,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { 
        orientation: orientation, 
        unit: "mm", 
        format: [doc.pageW, doc.pageH]  // Use actual page dimensions
      },
    };

    html2pdf().set(opt).from(element).save();
  }

  // Export to PNG
  function exportPNG(doc, pageIndex = 0, filename = "page.png") {
    const page = doc.pages[pageIndex];
    if (!page) return;

    const canvas = document.createElement("canvas");
    const svg = document.querySelector("#page-stage svg");
    
    if (svg) {
      const svgData = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const link = document.createElement("a");
        link.href = canvas.toDataURL("image/png");
        link.download = filename;
        link.click();
      };
      img.src = "data:image/svg+xml;base64," + btoa(svgData);
    }
  }

  // Export as JSON (native format)
  function exportJSON(doc, filename = "document.json") {
    const data = JSON.stringify(doc, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Export page dimensions info
  function getPageDimensions(doc) {
    return {
      width: doc.pageW + "mm",
      height: doc.pageH + "mm",
      marginTop: doc.margins.top + "mm",
      marginRight: doc.margins.right + "mm",
      marginBottom: doc.margins.bottom + "mm",
      marginLeft: doc.margins.left + "mm",
    };
  }

  // Generate document metadata
  function generateMetadata(doc) {
    return {
      title: doc.title || "Unnamed Document",
      author: doc.author || "Unknown",
      created: new Date().toISOString(),
      pages: doc.pages.length,
      language: doc.lang,
      pageSize: `${doc.pageW}x${doc.pageH}mm`,
    };
  }

  // Print to PDF
  function printToPDF() {
    window.print();
  }

  return {
    exportPDF,
    exportPNG,
    exportJSON,
    getPageDimensions,
    generateMetadata,
    printToPDF,
  };
})();
