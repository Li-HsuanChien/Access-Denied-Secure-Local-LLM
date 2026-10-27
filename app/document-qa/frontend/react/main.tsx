import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/tailwind.css';
import '../src/app.css';
import 'tippy.js/dist/tippy.css';
import '../src/lib/features/personality/personality.css';
import App from '../src/react/App';
import { mountWithLocale } from '../src/react/i18n/bootstrap';

const root = document.getElementById('root');

if (!root) {
	throw new Error('React application root is missing from the document.');
}

void mountWithLocale(() => {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>
	);
});
