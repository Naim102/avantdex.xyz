# Avantdex design system

Neo-brutalism on the brand palette. Light theme by default, dark theme with the sun/moon button (remembered in the browser).

| Token | Light | Dark |
|---|---|---|
| Brand green | `#28DF99` | `#28DF99` |
| Brand black | `#262627` | `#262627` (surfaces) |
| Page | `#F5F2E9` | `#171718` |
| Cards / inputs | `#FFFFFF`, 2 px black border, 4 px hard shadow | `#262627`, 2 px cream border, green hard shadow |
| Highlight (warnings, badges) | `#FFD84D`, `#FFE69A` | translucent yellow |
| Danger | `#B42318` on `#FFD5CF` | `#FF8077` on translucent red |

Rules: flat colors, no blur or gradients, thick borders, buttons "press" (shadow collapses) on click, headings in Space Grotesk bold uppercase, body in DM Sans, numbers and addresses in JetBrains Mono. Text on green is always black. All colors come from CSS variables in `src/index.css`, so a theme change never touches component code. Logo: `public/logo.png` (also the favicon).
