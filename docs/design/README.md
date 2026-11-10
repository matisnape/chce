# Design canvas backup

**TL;DR**: a copy of the redesign canvas, kept in the repo so it survives losing access to the original claude.ai artifact. The chosen design is **C** (sidebar of tabs, "Wszystko" view, floating "+ Dodaj" button), with phone variant **3** (wrapping chips). Issue #19 implements it.

The wishlist items and tab names are fake. The originals are private data and stay out of this public repo.

## What is here

- `canvas/canvas.json`: the board layout (positions, sizes, titles).
- `canvas/*.dc.html`: one board each.
  - `Main.dc.html` and `A-mobile.dc.html`: variant A, a single-column list.
  - `B-desktop.dc.html` and `B-mobile.dc.html`: variant B, a photo grid.
  - `C-desktop.dc.html` and `C-mobile.dc.html`: variant C, a tab sidebar on desktop. **Chosen.**
  - `C-mobile-sheet.dc.html`, `C-mobile-drill.dc.html` and `C-mobile-wrap.dc.html`: phone tab navigation, as a bottom sheet (1), as a list that opens a tab (2) and as wrapping chips (3). **Variant 3 was chosen.**

## How to read a board

- Each board is an HTML template.
  - `{{name}}` is a value from the `renderVals()` method in the `<script type="text/x-dc">` block at the end of the file.
  - `<sc-for>` repeats markup for each element of a list.
  - `<sc-if>` shows markup only when its value is true.
- The colour palette is the `P.light` / `P.dark` object in each script.
- The boards need the canvas runtime (`support.js`) to render, and that runtime is not stored here. Without it, read the markup and the inline styles as the specification.
