/**
 * colors.js — Color management, palettes, and gradients
 * Handles: color schemes, palettes, gradients, color harmony
 */

const Colors = (() => {
  "use strict";

  const palettes = {
    classic: {
      name: "Classic",
      colors: ["#1b1d22", "#2C6E67", "#8B4513", "#C0C0C0", "#FFD700"],
    },
    warm: {
      name: "Warm",
      colors: ["#8B4513", "#D2691E", "#CD853F", "#DEB887", "#F4A460"],
    },
    cool: {
      name: "Cool",
      colors: ["#000080", "#0047AB", "#4169E1", "#87CEEB", "#E0FFFF"],
    },
    vibrant: {
      name: "Vibrant",
      colors: ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF"],
    },
    pastel: {
      name: "Pastel",
      colors: ["#FFB3BA", "#FFDFBA", "#FFFFBA", "#BAFFC9", "#BAE1FF"],
    },
  };

  // Get color palette
  function getPalette(paletteName) {
    return palettes[paletteName] || palettes.classic;
  }

  // Get all palettes
  function getPalettes() {
    return Object.keys(palettes).map(key => ({
      id: key,
      name: palettes[key].name,
      colors: palettes[key].colors,
    }));
  }

  // Validate hex color
  function isValidColor(color) {
    return /^#[0-9A-F]{6}$/i.test(color);
  }

  // Convert RGB to Hex
  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    }).join("").toUpperCase();
  }

  // Convert Hex to RGB
  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    } : null;
  }

  // Create linear gradient
  function createLinearGradient(color1, color2, angle = 90) {
    return {
      type: "linear",
      color1,
      color2,
      angle,
    };
  }

  // Create radial gradient
  function createRadialGradient(color1, color2) {
    return {
      type: "radial",
      color1,
      color2,
    };
  }

  // Apply gradient to SVG element
  function applyGradientToSVG(element, gradient, svgEl) {
    if (!gradient || gradient.type !== "linear" && gradient.type !== "radial") {
      return;
    }

    const defs = svgEl.querySelector("defs") || document.createElementNS("http://www.w3.org/2000/svg", "defs");
    if (!svgEl.querySelector("defs")) svgEl.appendChild(defs);

    const gradId = "grad_" + Math.random().toString(36).slice(7);

    if (gradient.type === "linear") {
      const grad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
      grad.setAttribute("id", gradId);
      grad.setAttribute("x1", "0%");
      grad.setAttribute("y1", "0%");
      grad.setAttribute("x2", Math.cos((gradient.angle * Math.PI) / 180) * 100 + "%");
      grad.setAttribute("y2", Math.sin((gradient.angle * Math.PI) / 180) * 100 + "%");

      const stop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
      stop1.setAttribute("offset", "0%");
      stop1.setAttribute("stop-color", gradient.color1);
      grad.appendChild(stop1);

      const stop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
      stop2.setAttribute("offset", "100%");
      stop2.setAttribute("stop-color", gradient.color2);
      grad.appendChild(stop2);

      defs.appendChild(grad);
      element.setAttribute("fill", `url(#${gradId})`);
    }
  }

  return {
    getPalette,
    getPalettes,
    isValidColor,
    rgbToHex,
    hexToRgb,
    createLinearGradient,
    createRadialGradient,
    applyGradientToSVG,
  };
})();
