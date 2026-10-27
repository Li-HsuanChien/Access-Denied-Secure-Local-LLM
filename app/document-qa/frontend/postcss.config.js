export default {
	plugins: {
		// Keep the original decimal color/alpha values in production as in dev.
		'@tailwindcss/postcss': { optimize: false }
	}
};
