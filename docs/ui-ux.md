# PrismClause (TOS Red Flag Scanner) — UI/UX Design System & Behavior

## 1. Visual Identity & Aesthetic Principles
PrismClause is crafted with a high-end, cyberpunk security aesthetic utilizing dark glassmorphism, subtle neon accents, structured typography, and calm ambient depth. It prioritizes legibility and clarity while scanning dense, complex legal contracts.

### Core Color System Tokens
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

## 2. Typography & Layout Architecture

- **Font Stack**: `"Avenir Next", "Inter", "Segoe UI", sans-serif`
- **Shell Layout**: Centralized `.shell` container constrained to `width: min(1080px, calc(100% - 2rem))` with `2.4rem` vertical margin.
- **Surface Elevation**: Transparent, non-blurred base shell overlaying a high-contrast dark canvas to maximize text contrast and readability without GPU compositing degradation.

---

## 3. Background Architecture & Flicker-Free Guarantees

### Stable Multi-Layer Ambient Background
The background rendering is 100% stable, deterministic, and flicker-free:
1. **`.bg-video` Suppression**: The underlying video asset `background.mp4` contains intense cyberpunk glitch strobe frames and a stark white flash at second 14. To prevent eye strain and browser repainting flicker, `.bg-video` is permanently set to:
   ```css
   .bg-video {
     display: none;
   }
   ```
2. **`.bg-video-wrap` Radial Gradients**: Replaces video playback with a static, hardware-accelerated ambient cyber background:
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
3. **Scanline Mesh (`.bg-video-wrap::after`)**: Provides subtle high-tech CRT scanlines using a repeating linear gradient with 3% opacity.

---

## 4. Input Modalities & Controls

### Three-Way Tabbed Input System
1. **PDF Upload Tab**: Drag-and-drop zone supporting `.pdf` files up to 10MB. Features client-side file inspection and loading progress indicators.
2. **URL Fetcher Tab**: Clean input for Terms of Service URLs (e.g. `https://example.com/terms`) with automated SSRF safety checks.
3. **Raw Text Area Tab**: Direct paste input for unformatted policy excerpts.

### Sensitivity Switch
- **Broad Mode (Default)**: Highlights all potential contractual imbalances and ambiguities.
- **Strict Mode**: Restricts findings exclusively to severe rights waivers, mandatory arbitration, and broad indemnification.

---

## 5. Result Presentation & Analysis Components

### 5.1 Risk Score & Personalization Meter
- Visual progress meter indicating aggregate contract risk score (0 to 100).
- Dynamic Category Weight Sliders allowing users to customize priority (1 to 5) for Data Selling, Arbitration, Liability, Auto-Renewal, and IP Assignment.

### 5.2 The 5 Riskiest Ranked Red Flags
- Findings sorted by computed user impact magnitude (Critical, High, Medium, Low).
- Each card presents:
  - Severity badge and risk category tag.
  - Plain-English explanation of what the clause really means.
  - Exact legal quote from the source contract.
  - Page and section number attribution.
  - Detection provenance (`ai_enhanced` or `rule_based`).

### 5.3 Readability & Legalese Complexity Gauge
- Displays Flesch-Kincaid Grade Level and Reading Ease score.
- Categorizes legalese density into: *Plain*, *Moderate*, *Complex*, or *Very Complex*.

---

## 6. Actionable Remediation & Negotiation Tools

### 6.1 Formal Opt-Out Letter Generator (Phase 6)
- Generates legally grounded formal notices for:
  - Mandatory Arbitration Opt-Out (within 30-day statutory windows).
  - Third-Party Data Sharing Revocation.
  - Automatic Subscription Renewal Cancellation.
- Interactive modal with one-click copy and download.

### 6.2 Remediation Action Checklist (Phase 6)
- Auto-generates prioritized mitigation steps grouped into Immediate Actions and Long-Term Policies.

### 6.3 Contract Negotiation & Redline Amendments (Phase 7)
- Word-level redline diffing showing deleted harsh terms in red strikethrough and replacement protective terms in emerald green.
- Provides counter-proposal language with negotiation rationale.

### 6.4 Industry Benchmark Analytics (Phase 7)
- Compares the scanned contract against SaaS, Fintech, and Consumer sector risk distributions.

---

## 7. Phase 8 Advanced Modals

### 7.1 Multi-Vendor Comparison Matrix Modal (`#matrix-modal`)
- Compares 2 to 5 vendors side-by-side across all 14 risk categories.
- Renders an aligned comparison table with color-coded risk cells.
- Highlights the recommended lowest-risk vendor.

### 7.2 SaaS Portfolio Risk Engine Modal (`#portfolio-modal`)
- Aggregates an entire organizational SaaS stack.
- Calculates an Aggregate Portfolio Health Score (0–100).
- Identifies systemic risk concentrations where multiple vendors share hazardous clauses.

### 7.3 Policy Drift & Timeline Sentinel Modal (`#drift-modal`)
- Compares baseline policy text against updated policy text.
- Calculates Drift Direction (`MORE_RESTRICTIVE`, `MORE_PERMISSIVE`, `NEUTRAL`) and Shift Magnitude.
- Categorizes newly added restrictions and relaxed terms.

---

## 8. Modal Lifecycle & Accessibility Rules

- **Backdrop Masking**: `.modal-backdrop` uses `position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px);`.
- **Visibility State**: Controlled strictly via the `.hidden` class and HTML5 `hidden` attribute.
- **Dismiss Mechanics**:
  - Clicking the top-right `X` button (`#btn-close-*`).
  - Clicking the bottom `Close` button (`#btn-*-done`).
  - Clicking the darkened backdrop outside the modal window.
  - Pressing the `Escape` key.
- **Event Isolation**: Dismiss handlers use `e.preventDefault()` and `e.stopPropagation()` to prevent duplicate event bubbling or unintended page mutations.
- **CSP Compliance**: 100% of event handlers are bound via `addEventListener` in `app.js`. Zero inline `onclick` or style attributes exist.

---

## 9. Phase 9.3 SaaS View Navigation Architecture & Components

In Phase 9.3, the application was upgraded to a modern, first-class SaaS dashboard layout featuring instant client-side switching across 4 primary interfaces:

### 9.1 Topbar Navigation System
- `.nav-tabs-group`: Segmented pill controller in the top navigation bar with icons and text labels.
- `.nav-tab`: Interactive tab buttons for `#nav-tab-analyze`, `#nav-tab-portfolio`, `#nav-tab-sentinel`, and `#nav-tab-compliance`.
- `.nav-tab.active`: Highlights the active view using `--surface-raised` background and `--border-default`.

### 9.2 View Containers (`.app-view`)
- `.app-view`: Display block with a subtle `fadeIn` animation (0.18s ease-out).
- `.app-view.hidden`: Evaluates to `display: none !important;` to ensure inactive views do not occupy layout space or interfere with focus order.
- Views:
  1. `#view-analyze`: Document intake (URL, PDF, Text), 14-category risk flags, readability, checklists, export toolbar, and grounded Q&A.
  2. `#view-portfolio`: Active vendor stack manager (`.vendor-stack-card`), Aggregate score gauge (`.portfolio-gauge`), Systemic exposures (`.systemic-card`), Vendor rankings (`.vendor-rank-item`), and Head-to-head comparison matrix (`.matrix-table`, `.procurement-rec-banner`).
  3. `#view-sentinel`: Revision drift comparator, Snapshot controls, Direction badge (`.drift-badge-restrictive`, `.drift-badge-favorable`, `.drift-badge-neutral`), Added vs. Removed restriction boxes (`.drift-box-added`, `.drift-box-removed`), and inline word redlines (`.diff-content-view del`, `.diff-content-view ins`).
  4. `#view-compliance`: Statutory compliance audit (LexCheck), Dynamic regulatory jurisdiction selector, Standby/custom source toggle, Compliance standing badges, and Statutory citation cards (`.statutory-alert-item`, `.statutory-citation`).

### 9.3 Strict Accessibility & Zero-CSP Rules
- Every form input, select, and textarea has a dedicated `<label for="...">`.
- All buttons define `type="button"`.
- Zero inline styles (`style="..."`) and zero inline event handlers (`onclick`, `onsubmit`).
- Responsive layout with CSS grid auto-fill rules adapting seamlessly to mobile and desktop screens.
