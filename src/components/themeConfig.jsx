export const THEMES = [
    { id: 'default', name: 'Standard (Indigo)', primary: 'indigo', gray: 'slate' },
    { id: 'ocean', name: 'Ozean (Blau)', primary: 'blue', gray: 'slate' },
    { id: 'forest', name: 'Wald (Smaragd)', primary: 'emerald', gray: 'stone' },
    { id: 'sunset', name: 'Sonnenuntergang (Orange)', primary: 'orange', gray: 'stone' },
    { id: 'berry', name: 'Beere (Pink)', primary: 'pink', gray: 'slate' },
    { id: 'royal', name: 'Royal (Violett)', primary: 'violet', gray: 'gray' },
    { id: 'teal', name: 'Teal (Türkis)', primary: 'teal', gray: 'slate' },
    { id: 'cherry', name: 'Kirsche (Rot)', primary: 'red', gray: 'stone' },
    { id: 'coffee', name: 'Kaffee (Amber)', primary: 'amber', gray: 'stone' },
    { id: 'mono', name: 'Monochrom (Grau)', primary: 'gray', gray: 'slate' },
];

// Mapping of Tailwind colors to hex values for overrides
// We focus on the shades used most often: 50, 100, 200, 300, 400, 500, 600, 700, 800, 900
export const COLOR_PALETTES = {
    indigo: {
        50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3', 900: '#312e81'
    },
    slate: {
        50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a'
    },
    blue: {
        50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a'
    },
    emerald: {
        50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b'
    },
    stone: {
        50: '#fafaf9', 100: '#f5f5f4', 200: '#e7e5e4', 300: '#d6d3d1', 400: '#a8a29e', 500: '#78716c', 600: '#57534e', 700: '#44403c', 800: '#292524', 900: '#1c1917'
    },
    orange: {
        50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c', 800: '#9a3412', 900: '#7c2d12'
    },
    pink: {
        50: '#fdf2f8', 100: '#fce7f3', 200: '#fbcfe8', 300: '#f9a8d4', 400: '#f472b6', 500: '#ec4899', 600: '#db2777', 700: '#be185d', 800: '#9d174d', 900: '#831843'
    },
    violet: {
        50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6', 900: '#4c1d95'
    },
    gray: {
        50: '#f9fafb', 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5db', 400: '#9ca3af', 500: '#6b7280', 600: '#4b5563', 700: '#374151', 800: '#1f2937', 900: '#111827'
    },
    teal: {
        50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e', 800: '#115e59', 900: '#134e4a'
    },
    red: {
        50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 700: '#b91c1c', 800: '#991b1b', 900: '#7f1d1d'
    },
    amber: {
        50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f'
    }
};

export const generateThemeCss = (themeId) => {
    const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
    if (theme.id === 'default') return ''; // No override needed

    const primaryPalette = COLOR_PALETTES[theme.primary];
    const grayPalette = COLOR_PALETTES[theme.gray];

    let css = `/* Theme: ${theme.name} */\n`;
    
    // Override Indigo (Primary)
    if (primaryPalette) {
        Object.keys(primaryPalette).forEach(shade => {
            const color = primaryPalette[shade];
            css += `
                body .bg-indigo-${shade} { background-color: ${color} !important; }
                body .text-indigo-${shade} { color: ${color} !important; }
                body .border-indigo-${shade} { border-color: ${color} !important; }
                body .ring-indigo-${shade} { --tw-ring-color: ${color} !important; }
                body .hover\\:bg-indigo-${shade}:hover { background-color: ${color} !important; }
                body .hover\\:text-indigo-${shade}:hover { color: ${color} !important; }
            `;
        });
        // Button variants often use these
        css += `
            body .button-primary { background-color: ${primaryPalette[600]} !important; }
            body .button-primary:hover { background-color: ${primaryPalette[700]} !important; }
        `;
    }

    // Override Slate (Gray/Neutral)
    if (grayPalette && theme.gray !== 'slate') {
         Object.keys(grayPalette).forEach(shade => {
            const color = grayPalette[shade];
            css += `
                body .bg-slate-${shade} { background-color: ${color} !important; }
                body .text-slate-${shade} { color: ${color} !important; }
                body .border-slate-${shade} { border-color: ${color} !important; }
                body .ring-slate-${shade} { --tw-ring-color: ${color} !important; }
                body .hover\\:bg-slate-${shade}:hover { background-color: ${color} !important; }
                body .hover\\:text-slate-${shade}:hover { color: ${color} !important; }
            `;
        });
    }

    return css;
};