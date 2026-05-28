# SVG Transform Diagnostic Test

This file tests how the WebView renders SVG text with parent group transforms.

<svg xmlns='http://www.w3.org/2000/svg' width='400' height='200' viewBox='0 0 400 200'>
  <rect width='400' height='200' fill='#222'/>
  
  <!-- Case A: no parent transform -->
  <text x='10' y='40' fill='white' font-size='14'>A: no parent transform (should be upright)</text>
  
  <!-- Case B: inside single scaleY=-1 group (tikzjax pattern) -->
  <g transform='matrix(1 0 0 -1 0 200)'>
    <text x='10' y='-120' fill='white' font-size='14' transform='matrix(1 0 0 -1 0 0)'>B: single flip group + counter-flip text</text>
  </g>
  
  <!-- Case C: text with scaleY=-1 only (no counter-flip, for comparison) -->
  <g transform='matrix(1 0 0 -1 0 200)'>
    <text x='10' y='-150' fill='white' font-size='14'>C: single flip group, no counter-flip (should be upside-down)</text>
  </g>
  
  <!-- Case D: nested groups scaleY=-1 * scaleY=-1 = net +1 -->
  <g transform='scale(1 -1)'>
    <g transform='scale(1 -1)'>
      <text x='10' y='180' fill='white' font-size='14'>D: double-flip groups (net = upright)</text>
    </g>
  </g>
</svg>

**Expected (Chrome-like correct behavior):**
- A: upright
- B: upright (double negative = positive)
- C: upside-down (only parent flip, no counter)
- D: upright (double flip = neutral)

**If VS Code shows B or D as upside-down:** VS Code does NOT compose parent group scaleY for text.
**If VS Code shows B correct but D wrong (or vice versa):** the bug is depth-specific.
