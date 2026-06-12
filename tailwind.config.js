/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand palette — TikTok Community Manager
        brand: {
          pink: '#EE1D52',
          'pink-soft': '#FF5B85',
          cyan: '#69C9D0',
          navy: '#050816',
          'navy-2': '#080B18',
          card: '#0B0F1E',
        },
        // Legacy "like" accent now maps to brand pink hues
        like: {
          50: '#fff0f4',
          300: '#ff8aa8',
          400: '#ff5b85',
          500: '#ee1d52',
          600: '#d01244',
          700: '#a80f38',
        },
        // Theme-aware neutral scale: dark = navy-tinted, light = inverted slate.
        // Driven by CSS vars in index.css so the whole app re-themes at once.
        zinc: {
          50: 'rgb(var(--z-50) / <alpha-value>)',
          100: 'rgb(var(--z-100) / <alpha-value>)',
          200: 'rgb(var(--z-200) / <alpha-value>)',
          300: 'rgb(var(--z-300) / <alpha-value>)',
          400: 'rgb(var(--z-400) / <alpha-value>)',
          500: 'rgb(var(--z-500) / <alpha-value>)',
          600: 'rgb(var(--z-600) / <alpha-value>)',
          700: 'rgb(var(--z-700) / <alpha-value>)',
          800: 'rgb(var(--z-800) / <alpha-value>)',
          900: 'rgb(var(--z-900) / <alpha-value>)',
          950: 'rgb(var(--z-950) / <alpha-value>)',
        },
      },
      borderRadius: {
        card: '16px',
        'card-lg': '18px',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Inter', 'sans-serif'],
        mono: ['SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(90deg, #EE1D52, #69C9D0)',
        'pink-gradient': 'linear-gradient(135deg, #EE1D52, #FF5B85)',
        'sidebar-gradient': 'linear-gradient(180deg, #050816 0%, #080B18 100%)',
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'toast-in': 'toastIn 0.3s ease-out',
        'slide-in': 'slideIn 0.3s ease-out',
        'fade-up': 'fadeUp 0.2s ease-out',
      },
      keyframes: {
        toastIn: {
          from: { transform: 'translateX(-120%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        slideIn: {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        fadeUp: {
          from: { transform: 'translateY(12px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
