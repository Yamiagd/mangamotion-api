// ============================================================
// MangaMotion Pro – Backend API Server
// ============================================================
// Run: npm install express multer cors node-canvas
// Run: node server.js
// ============================================================

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer config – store in memory
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// ============================================================
// IN-MEMORY PROJECT STORE (for demo)
// ============================================================
const projects = new Map(); // projectId -> { layers, currentLayer, frameRate, name }
let projectCounter = 0;

// ============================================================
// IMAGE PROCESSING HELPERS (same algorithm as frontend)
// ============================================================
const W = 1600, H = 900;

function createEmptyImageData() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  return ctx.getImageData(0, 0, W, H);
}

function cloneImageData(imgData) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const newData = ctx.createImageData(W, H);
  newData.data.set(imgData.data);
  return newData;
}

// Convert ImageData to base64
function imageDataToBase64(imgData) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

// Base64 to ImageData
async function base64ToImageData(base64) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const img = await loadImage(base64);
  ctx.drawImage(img, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H);
}

// Cut background algorithm (same as frontend)
function cutBackgroundAI(imgData) {
  const d = imgData.data;
  const bgR = 17, bgG = 24, bgB = 32, threshold = 50;
  const bgMask = new Uint8Array(d.length / 4);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], b = d[i+2];
    if (Math.abs(r - bgR) < threshold && Math.abs(g - bgG) < threshold && Math.abs(b - bgB) < threshold) {
      bgMask[i/4] = 1;
    }
  }
  for (let i = 0; i < d.length; i += 4) {
    if (bgMask[i/4]) d[i+3] = 0;
  }
  // Inpaint
  const copy = new Uint8ClampedArray(d);
  for (let y = 1; y < H-1; y++) {
    for (let x = 1; x < W-1; x++) {
      const idx = (y * W + x) * 4;
      if (d[idx+3] === 0) {
        let found = false;
        for (let radius = 1; radius <= 20; radius++) {
          let sumR = 0, sumG = 0, sumB = 0, count = 0;
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
              const ni = (ny * W + nx) * 4;
              if (copy[ni+3] > 0) {
                const dist = Math.sqrt(dx*dx + dy*dy);
                const w = 1 / (dist + 1);
                sumR += copy[ni] * w;
                sumG += copy[ni+1] * w;
                sumB += copy[ni+2] * w;
                count += w;
              }
            }
          }
          if (count > 0) {
            d[idx] = sumR / count;
            d[idx+1] = sumG / count;
            d[idx+2] = sumB / count;
            d[idx+3] = 255;
            found = true;
            break;
          }
        }
      }
    }
  }
  return imgData;
}

function refillMissingAI(imgData) {
  const d = imgData.data;
  const copy = new Uint8ClampedArray(d);
  for (let y = 1; y < H-1; y++) {
    for (let x = 1; x < W-1; x++) {
      const idx = (y * W + x) * 4;
      if (d[idx+3] === 0) {
        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        for (let radius = 1; radius <= 25; radius++) {
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
              const ni = (ny * W + nx) * 4;
              if (copy[ni+3] > 0) {
                const dist = Math.sqrt(dx*dx + dy*dy);
                const w = 1 / (dist + 1);
                sumR += copy[ni] * w;
                sumG += copy[ni+1] * w;
                sumB += copy[ni+2] * w;
                count += w;
              }
            }
          }
          if (count > 0) break;
        }
        if (count > 0) {
          d[idx] = sumR / count;
          d[idx+1] = sumG / count;
          d[idx+2] = sumB / count;
          d[idx+3] = 255;
        }
      }
    }
  }
  return imgData;
}

// ============================================================
// API ENDPOINTS
// ============================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// Upload image – returns base64 of processed image (or just stores)
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }
    const buffer = req.file.buffer;
    const base64 = `data:${req.file.mimetype};base64,${buffer.toString('base64')}`;
    // Convert to ImageData
    const imgData = await base64ToImageData(base64);
    // Return base64 version
    const outBase64 = imageDataToBase64(imgData);
    res.json({ success: true, data: outBase64 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cut background – expects { image: base64 }
app.post('/api/cut-bg', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Missing image data' });
    const imgData = await base64ToImageData(image);
    const processed = cutBackgroundAI(imgData);
    const outBase64 = imageDataToBase64(processed);
    res.json({ success: true, data: outBase64 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Refill – expects { image: base64 }
app.post('/api/refill', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Missing image data' });
    const imgData = await base64ToImageData(image);
    const processed = refillMissingAI(imgData);
    const outBase64 = imageDataToBase64(processed);
    res.json({ success: true, data: outBase64 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save project – expects { name, layers, currentLayer, frameRate }
app.post('/api/project', async (req, res) => {
  try {
    const { name, layers: layerData, currentLayer, frameRate } = req.body;
    if (!layerData || !Array.isArray(layerData)) {
      return res.status(400).json({ error: 'Invalid layers data' });
    }
    const projectId = ++projectCounter;
    // Store serialized layers (with base64 image data)
    const storedLayers = [];
    for (const layer of layerData) {
      // layer.data is ImageData-like? In frontend we send as object with data array? 
      // We'll expect that the client sends an object with a 'data' property that is an array of pixel values.
      // For simplicity, we'll store as base64.
      // But we'll handle both: if it's a base64 string, use that; else convert.
      let layerImageBase64;
      if (layer.data && typeof layer.data === 'string' && layer.data.startsWith('data:image')) {
        layerImageBase64 = layer.data;
      } else if (layer.data && layer.data.data) {
        // Assume it's an array-like
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');
        const imgData = ctx.createImageData(W, H);
        imgData.data.set(layer.data.data || layer.data);
        ctx.putImageData(imgData, 0, 0);
        layerImageBase64 = canvas.toDataURL('image/png');
      } else {
        // fallback – empty
        const empty = createEmptyImageData();
        layerImageBase64 = imageDataToBase64(empty);
      }
      storedLayers.push({
        name: layer.name || 'Layer',
        visible: layer.visible !== undefined ? layer.visible : true,
        blendMode: layer.blendMode || 'normal',
        data: layerImageBase64
      });
    }
    const project = {
      id: projectId,
      name: name || `Project ${projectId}`,
      layers: storedLayers,
      currentLayer: currentLayer || 0,
      frameRate: frameRate || 24,
      createdAt: new Date().toISOString()
    };
    projects.set(projectId, project);
    res.json({ success: true, projectId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Load project by id
app.get('/api/project/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!projects.has(id)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const project = projects.get(id);
    res.json({ success: true, project });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all projects (metadata)
app.get('/api/projects', (req, res) => {
  const list = Array.from(projects.values()).map(p => ({
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    layerCount: p.layers.length
  }));
  res.json({ success: true, projects: list });
});

// Delete project
app.delete('/api/project/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!projects.has(id)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    projects.delete(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// STATIC FILES (optional – serve frontend)
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all to serve index.html if frontend exists
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) res.status(404).json({ error: 'Not found' });
  });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`MangaMotion Pro API running on http://localhost:${PORT}`);
  console.log(`Endpoints:`);
  console.log(`  POST /api/upload       – upload image`);
  console.log(`  POST /api/cut-bg       – AI background removal`);
  console.log(`  POST /api/refill       – AI refill missing parts`);
  console.log(`  POST /api/project      – save project`);
  console.log(`  GET  /api/project/:id  – load project`);
  console.log(`  GET  /api/projects     – list all projects`);
  console.log(`  DELETE /api/project/:id – delete project`);
});
