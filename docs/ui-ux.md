# PrismClause (ToS Red Flag Scanner) — UI/UX Design System & Analyze Interface

**Project:** PrismClause / ToS Red Flag Scanner
**Document Version:** 3.0 (Analyze-Only Design System)
**Status:** Canonical Frontend UI/UX Specification

---

## 1. Visual Identity & Aesthetic Principles

PrismClause utilizes a dark cyber-security aesthetic combining dark glassmorphism, structured typography, subtle neon ambient glow, and high-contrast text to maximize legibility when reading dense legal clauses.

### Core Color System Tokens
Defined in `frontend/public/styles.css`:
```css
:root {
  --bg: #141728;
  --paper: rgba(14, 18, 34, 0.24);
  --paper-2: rgba(14, 18, 34, 0.36);
  --ink: #ecf0ff;
  --ink-soft: #c7cde9;
  --line: rgba(236, 240, 255, 0.2);
  --accent: #55529a;
  --accent-2: #8f6f66;
  --accent-3: #4f7f79;
  --danger: #c65b68;
  --warn: #bb8b4a;
  --ok: #4b8a63;
}
```

- **Base Canvas**: `#090b16` (Deep Midnight Obsidian)
- **Primary Accent**: `#55529a` (Cyber Violet)
- **High Risk / Danger**: `#c65b68` (Coral Crimson)
- **Warning / Medium Risk**: `#bb8b4a` (Amber Ochre)
- **Low Risk / Safe**: `#4b8a63` (Emerald Moss)

---

## 2. Typography & Shell Layout

- **Font Stack**: `"Avenir Next", "Inter", "Segoe UI", -apple-system, sans-serif`
- **Shell Layout**: Centralized `.shell` container constrained to `width: min(1080px, calc(100% - 2rem))` with `2.4rem` vertical breathing margins.
- **Surface Elevation**: Transparent base shell overlaying a high-contrast dark canvas to maximize text contrast and readability without GPU compositing degradation.

---

## 3. Background Architecture & Flicker-Free Guarantees

### Stable Multi-Layer Ambient Background
The background rendering is 100% stable, deterministic, and flicker-free:
1. **`.bg-video` Permanent Suppression**: The underlying video asset contains intense cyberpunk strobe frames and stark flashes. To eliminate eye strain and repainting flicker, `.bg-video` is permanently suppressed:
   ```css
   .bg-video {
     display: none;
   }
   ```
2. **Hardware-Accelerated Radial Gradients (`.bg-video-wrap`)**:
   ```css
   .bg-video-wrap {
     position: fixed;
     inset: 0;
     z-index: 0;
     overflow: hidden;
     pointer-events: none;
     background:
       radial-gradient(ellipse 80% 50% at 50% -10%, rgba(85, 82, 154, 0.28), transparent 70%),
       radial-gradient(circle 600px at 85% 75%, rgba(79, 127, 121, 0.18), transparent 70%),
       radial-gradient(circle 500px at 15% 85%, rgba(143, 111, 102, 0.12), transparent 70%),
       #090b16;
   }
   ```
3. **Subtle Scanline Mesh (`.bg-video-wrap::after`)**: Renders high-tech CRT scanlines using a repeating linear gradient with 3% opacity.

---

## 4. Analyze Workflow Components

The web application is intentionally focused on the **Analyze** workflow:

### 4.1 Three-Way Input Modality Tabs
- **URL Tab (`#tab-url`):** Input field for scanning online legal agreements (e.g. `https://example.com/terms`) with automated client validation and server-side SSRF safety checks.
- **PDF Upload Tab (`#tab-pdf`):** Drag-and-drop zone supporting `.pdf` files up to 10MB with client-side file inspection and memory parsing.
- **Raw Text Tab (`#tab-text`):** Clean text area for pasting unformatted contract excerpts.

### 4.2 Risk Scoring & Summary Meter
- **Overall Risk Meter:** 0–100 score gauge with dynamic color transitions:
  - $0\text{--}35$: Emerald Green (Low Risk / Standard Consumer Terms)
  - $36\text{--}65$: Amber Ochre (Moderate Risk / Standard Commercial Imbalances)
  - $66\text{--}100$: Coral Crimson (High Risk / Critical Rights Waivers)
- **Severity Summary Counts:** Breakdown badges showing total High, Medium, and Low severity findings.

### 4.3 Readability & Legalese Transparency Panel
- **Flesch Reading Ease:** Displays numerical score and qualitative label (e.g., *Difficult*, *Standard*, *Easy*).
- **Flesch-Kincaid Grade Level:** Indicates the equivalent US educational schooling grade required for comprehension.

### 4.4 Risk Findings & Evidence Cards
- Interactive clause cards displaying:
  - Canonical Risk Category badge (e.g., `Mandatory Binding Arbitration`, `Unilateral Modification`).
  - Severity level tag (`HIGH`, `MEDIUM`, `LOW`).
  - Plain-English translation explaining what the clause means in simple terms.
  - "Why it matters" impact explanation.
  - Verbatim excerpted contract text with segment identifier (`seg_X`).

### 4.5 Interactive Grounded Q&A Interface
- Contextual question input box (3–500 characters) with real-time character counter.
- Evidence Grounding Badge: Indicates whether the response was derived strictly from contract text.
- Independent DeBERTa NLI Verification Badge:
  - `SUPPORTED` (Green): Mathematically entailed by contract evidence.
  - `UNCERTAIN` (Amber): Ambiguous or out-of-scope refusal.
  - `CONTRADICTED` (Red): Hallucination or factual discrepancy alert.
- Cited Evidence Drawer: Expandable cards showing the exact clauses retrieved and their cosine similarity percentages.
