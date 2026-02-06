---
title: AlphaZero Board Games
emoji: 🎮
colorFrom: blue
colorTo: purple
sdk: static
pinned: false
---

# SkyZero Playground 🎮

**SkyZero** is a browser-based AI board game platform powered by **AlphaZero** algorithms. It runs neural network inference entirely in your browser using **ONNX Runtime Web**, providing a seamless, server-less AI opponent experience.

## ✨ Features

- **Client-Side AI**: No backend server required for gameplay. All AI calculations happen locally on your device using WebAssembly (WASM).
- **Multiple Games**:
  - **Tic-Tac-Toe** (井字棋): Classic 3x3 game.
  - **Connect 4** (四子棋): Connect four discs vertically, horizontally, or diagonally.
  - **Gomoku** (五子棋): 9x9 board implementation of the classic strategy game.
- **Real-time Analysis**:
  - **Win Rate Estimation**: See the AI's confidence in the current board state (Value Head).
  - **Policy Visualization**: Visual indicators of the AI's considered moves (Policy Head).
- **Interactive UI**: Clean, responsive interface built with Tailwind CSS.

## 🚀 Quick Start

### Running Locally

You can run this project with any static file server.

**Using Python:**
```bash
# Python 3
python -m http.server 8000
```
Then open `http://localhost:8000` in your browser.

**Using Node.js (http-server):**
```bash
npx http-server .
```

## 🛠️ Technology Stack

- **Frontend**: HTML5, Vanilla JavaScript, Tailwind CSS.
- **Inference Engine**: [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) (ORT Web).
- **Models**: AlphaZero-style ResNet models trained in PyTorch and exported to ONNX format.

## 🧠 Model Training & Export

The project includes scripts for model handling (likely used during development):
- `export_onnx.py`: Script to convert PyTorch checkpoints to ONNX format.
- `checkpoints/`: Directory containing trained model weights.

## 📄 License

MIT License
