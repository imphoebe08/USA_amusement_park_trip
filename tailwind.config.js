/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sand: '#F7F4EB',
        cream: '#FFFDF8',
        moss: '#7D8F6A',
        olive: '#56694A',
        clay: '#D8B38A',
        terracotta: '#C67C5C',
        pine: '#4B6B4D',
        sage: '#DDE5D6',
        ink: '#3E3A36',
        muted: '#7D776F',
      },
      boxShadow: {
        soft: '4px 4px 0px #E0E5D5',
        card: '0 10px 30px rgba(110, 108, 98, 0.08)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      fontFamily: {
        sans: ['"Noto Sans TC"', '"PingFang TC"', '"Segoe UI"', 'sans-serif'],
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-4px)' },
        },
      },
      animation: {
        float: 'float 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}

