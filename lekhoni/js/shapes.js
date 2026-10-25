/**
 * shapes.js — Geometric shapes and drawing tools
 * Handles: shapes, lines, curves, bezier paths
 */

const Shapes = (() => {
  "use strict";

  // Add shape properties to box
  function initShapeBox(box, shapeType = "rectangle") {
    box.shapeType = shapeType;
    box.fillColor = "#FFFFFF";
    box.strokeColor = "#000000";
    box.strokeWidth = 1;
    box.strokeDasharray = "none";
    box.rotation = 0;
    box.opacity = 1;
    return box;
  }

  // Render shape in SVG
  function renderShape(box, pageEl, mmToPx, selectedBoxId) {
    const x = mmToPx(box.x);
    const y = mmToPx(box.y);
    const w = mmToPx(box.w);
    const h = mmToPx(box.h);

    let shape = null;

    switch (box.shapeType) {
      case "rectangle":
        shape = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        shape.setAttribute("x", x);
        shape.setAttribute("y", y);
        shape.setAttribute("width", w);
        shape.setAttribute("height", h);
        break;

      case "circle":
        shape = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        shape.setAttribute("cx", x + w / 2);
        shape.setAttribute("cy", y + h / 2);
        shape.setAttribute("r", Math.min(w, h) / 2);
        break;

      case "ellipse":
        shape = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
        shape.setAttribute("cx", x + w / 2);
        shape.setAttribute("cy", y + h / 2);
        shape.setAttribute("rx", w / 2);
        shape.setAttribute("ry", h / 2);
        break;

      case "line":
        shape = document.createElementNS("http://www.w3.org/2000/svg", "line");
        shape.setAttribute("x1", x);
        shape.setAttribute("y1", y);
        shape.setAttribute("x2", x + w);
        shape.setAttribute("y2", y + h);
        shape.setAttribute("stroke-linecap", "round");
        break;

      case "polygon":
        shape = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        const points = `${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`;
        shape.setAttribute("points", points);
        break;

      case "star":
        shape = createStar(x, y, w, h);
        break;
    }

    if (shape) {
      shape.setAttribute("fill", box.fillColor);
      shape.setAttribute("stroke", box.strokeColor);
      shape.setAttribute("stroke-width", box.strokeWidth);
      if (box.strokeDasharray !== "none") {
        shape.setAttribute("stroke-dasharray", box.strokeDasharray);
      }
      shape.setAttribute("opacity", box.opacity);
      if (box.rotation) {
        shape.setAttribute("transform", `rotate(${box.rotation} ${x + w / 2} ${y + h / 2})`);
      }
      shape.setAttribute("data-box-id", box.id);
      shape.classList.add("shape-element");

      if (selectedBoxId === box.id) {
        shape.setAttribute("stroke", "#2C6E67");
        shape.setAttribute("stroke-dasharray", "4,2");
        shape.setAttribute("stroke-width", "2");
      }

      return shape;
    }
    return null;
  }

  function createStar(x, y, w, h) {
    const points = [];
    const cx = x + w / 2;
    const cy = y + h / 2;
    const outerR = Math.min(w, h) / 2;
    const innerR = outerR * 0.4;

    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const angle = (i * Math.PI) / 5 - Math.PI / 2;
      points.push(cx + r * Math.cos(angle));
      points.push(cy + r * Math.sin(angle));
    }

    const star = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    star.setAttribute("points", points.join(" "));
    return star;
  }

  return {
    initShapeBox,
    renderShape,
  };
})();
