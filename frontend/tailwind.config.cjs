/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        mist: "#f2f7f5",
        pine: "#1d4f47",
        amber: "#ffb84d",
        ink: "#1a2128",
        skyline: "#d8ecf2"
      },
      fontFamily: {
        heading: ["'Space Grotesk'", "sans-serif"],
        body: ["'Source Sans 3'", "sans-serif"]
      },
      boxShadow: {
        card: "0 8px 24px rgba(26, 33, 40, 0.08)"
      }
    }
  },
  plugins: []
};

