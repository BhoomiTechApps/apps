/**
 * layers.js — Layer management, Z-order, object stacking
 * Handles: layer visibility, stacking order, object selection
 */

const Layers = (() => {
  "use strict";

  // Move object to front
  function bringToFront(page, boxId) {
    const idx = page.boxes.findIndex(b => b.id === boxId);
    if (idx > -1) {
      const box = page.boxes.splice(idx, 1)[0];
      page.boxes.push(box);
    }
  }

  // Move object to back
  function sendToBack(page, boxId) {
    const idx = page.boxes.findIndex(b => b.id === boxId);
    if (idx > -1) {
      const box = page.boxes.splice(idx, 1)[0];
      page.boxes.unshift(box);
    }
  }

  // Move object forward one layer
  function moveForward(page, boxId) {
    const idx = page.boxes.findIndex(b => b.id === boxId);
    if (idx > -1 && idx < page.boxes.length - 1) {
      const temp = page.boxes[idx];
      page.boxes[idx] = page.boxes[idx + 1];
      page.boxes[idx + 1] = temp;
    }
  }

  // Move object backward one layer
  function moveBackward(page, boxId) {
    const idx = page.boxes.findIndex(b => b.id === boxId);
    if (idx > 0) {
      const temp = page.boxes[idx];
      page.boxes[idx] = page.boxes[idx - 1];
      page.boxes[idx - 1] = temp;
    }
  }

  // Toggle layer visibility
  function toggleVisibility(box) {
    box.hidden = !box.hidden;
    return box.hidden;
  }

  // Lock/unlock layer
  function toggleLock(box) {
    box.locked = !box.locked;
    return box.locked;
  }

  // Get layer info
  function getLayerInfo(page) {
    return page.boxes.map((box, idx) => ({
      id: box.id,
      type: box.type,
      index: idx,
      visible: !box.hidden,
      locked: box.locked || false,
      name: box.name || `${box.type} ${idx + 1}`,
    }));
  }

  // Set object name
  function setObjectName(box, name) {
    box.name = name;
    return box;
  }

  // Group objects
  function groupObjects(page, boxIds) {
    const group = {
      id: "g" + Math.random().toString(36).slice(2, 10),
      type: "group",
      objects: boxIds,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    };
    page.boxes.push(group);
    return group;
  }

  // Ungroup objects
  function ungroupObjects(page, groupId) {
    const groupIdx = page.boxes.findIndex(b => b.id === groupId);
    if (groupIdx > -1 && page.boxes[groupIdx].type === "group") {
      page.boxes.splice(groupIdx, 1);
    }
  }

  return {
    bringToFront,
    sendToBack,
    moveForward,
    moveBackward,
    toggleVisibility,
    toggleLock,
    getLayerInfo,
    setObjectName,
    groupObjects,
    ungroupObjects,
  };
})();
