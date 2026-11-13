/**
 * typography.js — Advanced text formatting and typography controls
 * Handles: line spacing, indentation, kerning, leading, tracking
 */

const Typography = (() => {
  "use strict";

  // Initialize typography properties
  function initTypography(box) {
    if (box.type !== "text") return box;
    
    box.lineHeight = 1.2;
    box.letterSpacing = 0;
    box.wordSpacing = 0;
    box.indentFirst = 0;
    box.indentLeft = 0;
    box.indentRight = 0;
    box.textTransform = "none"; // uppercase, lowercase, capitalize
    box.fontWeight = 400;
    box.fontStyle = "normal";
    box.textDecoration = "none";
    box.textShadow = "none";
    box.dropCapEnabled = false;
    box.dropCapLines = 2;
    box.dropCapCharacters = 1;

    return box;
  }

  // Apply typography styles to text element
  function applyTypographyStyles(textEl, box) {
    if (!box.text) return;

    let text = box.text;

    // Apply text transform
    if (box.textTransform === "uppercase") text = text.toUpperCase();
    else if (box.textTransform === "lowercase") text = text.toLowerCase();
    else if (box.textTransform === "capitalize") {
      text = text.replace(/\b\w/g, char => char.toUpperCase());
    }

    textEl.textContent = text;
    
    // Apply CSS styles correctly using style property, not attributes
    textEl.style.lineHeight = box.lineHeight || 1.2;
    textEl.style.letterSpacing = (box.letterSpacing || 0) + "px";
    textEl.style.wordSpacing = (box.wordSpacing || 0) + "px";
    textEl.style.paddingLeft = (box.indentLeft || 0) + "mm";
    textEl.style.paddingRight = (box.indentRight || 0) + "mm";
    textEl.style.textIndent = (box.indentFirst || 0) + "mm";
    textEl.style.whiteSpace = "pre-wrap"; // Preserve formatting
    
    if (box.textShadow && box.textShadow !== "none") {
      textEl.style.textShadow = box.textShadow;
    }
  }

  // Format paragraph with indentation
  function formatParagraph(box) {
    const styles = {
      "padding-left": box.indentLeft + "mm",
      "padding-right": box.indentRight + "mm",
      "text-indent": box.indentFirst + "mm",
      "line-height": box.lineHeight,
      "letter-spacing": box.letterSpacing + "px",
      "word-spacing": box.wordSpacing + "px",
    };

    if (box.dropCapEnabled && box.text) {
      return { ...styles, dropCap: true };
    }

    return styles;
  }

  // Calculate leading (line spacing)
  function getLeading(fontSize, lineHeight) {
    return Math.round(fontSize * lineHeight);
  }

  // Validate typography values
  function validateValues(box) {
    const valid = {
      lineHeight: Math.max(0.8, Math.min(3, box.lineHeight || 1.2)),
      letterSpacing: Math.max(-2, Math.min(10, box.letterSpacing || 0)),
      wordSpacing: Math.max(-2, Math.min(10, box.wordSpacing || 0)),
      indentFirst: Math.max(-50, Math.min(100, box.indentFirst || 0)),
      indentLeft: Math.max(0, Math.min(200, box.indentLeft || 0)),
      indentRight: Math.max(0, Math.min(200, box.indentRight || 0)),
    };
    return valid;
  }

  return {
    initTypography,
    applyTypographyStyles,
    formatParagraph,
    getLeading,
    validateValues,
  };
})();
