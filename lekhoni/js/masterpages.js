/**
 * masterpages.js — Master pages, templates, and layout management
 * Handles: master pages, templates, page styles, layout presets
 */

const MasterPages = (() => {
  "use strict";

  const templates = {
    blank: {
      name: "Blank",
      pageW: 210,
      pageH: 297,
      margins: { top: 20, right: 18, bottom: 20, left: 18 },
      columns: 1,
      columnGap: 0,
    },
    twoColumn: {
      name: "Two Column",
      pageW: 210,
      pageH: 297,
      margins: { top: 20, right: 18, bottom: 20, left: 18 },
      columns: 2,
      columnGap: 8,
    },
    threeColumn: {
      name: "Three Column",
      pageW: 210,
      pageH: 297,
      margins: { top: 20, right: 18, bottom: 20, left: 18 },
      columns: 3,
      columnGap: 6,
    },
    newsletter: {
      name: "Newsletter",
      pageW: 210,
      pageH: 297,
      margins: { top: 25, right: 20, bottom: 25, left: 20 },
      columns: 2,
      columnGap: 10,
      header: { enabled: true, text: "NEWSLETTER", showOnFirst: true },
      footer: { enabled: true, text: "© 2024", showOnFirst: true },
    },
    bookPage: {
      name: "Book Page",
      pageW: 210,
      pageH: 297,
      margins: { top: 30, right: 25, bottom: 30, left: 30 },
      columns: 1,
      columnGap: 0,
      header: { enabled: true, text: "{page}", showOnFirst: false },
      footer: { enabled: true, text: "", showOnFirst: false },
    },
  };

  // Create master page
  function createMasterPage(templateName) {
    const template = templates[templateName] || templates.blank;
    return {
      name: template.name,
      pageW: template.pageW,
      pageH: template.pageH,
      margins: { ...template.margins },
      columns: template.columns || 1,
      columnGap: template.columnGap || 0,
      header: template.header ? { ...template.header } : { enabled: false, text: "", showOnFirst: true },
      footer: template.footer ? { ...template.footer } : { enabled: false, text: "", showOnFirst: true },
    };
  }

  // Apply master page to document
  function applyMasterPage(doc, masterPage) {
    doc.pageW = masterPage.pageW;
    doc.pageH = masterPage.pageH;
    doc.margins = { ...masterPage.margins };
    doc.columns = masterPage.columns;
    doc.columnGap = masterPage.columnGap;
    doc.header = { ...masterPage.header };
    doc.footer = { ...masterPage.footer };
    return doc;
  }

  // Calculate column width
  function getColumnWidth(pageW, margins, columns, columnGap) {
    const availableWidth = pageW - margins.left - margins.right;
    const totalGap = columnGap * (columns - 1);
    return (availableWidth - totalGap) / columns;
  }

  // Get column position (pageH parameter added for correct height calculation)
  function getColumnPosition(columnIndex, pageW, pageH, margins, columnWidth, columnGap) {
    const x = margins.left + columnIndex * (columnWidth + columnGap);
    return {
      x: x,
      y: margins.top,
      width: columnWidth,
      height: pageH - margins.top - margins.bottom,  // Fixed: now uses pageH
    };
  }

  // List available templates
  function getTemplates() {
    return Object.keys(templates).map(key => ({
      id: key,
      name: templates[key].name,
    }));
  }

  return {
    createMasterPage,
    applyMasterPage,
    getColumnWidth,
    getColumnPosition,
    getTemplates,
  };
})();
