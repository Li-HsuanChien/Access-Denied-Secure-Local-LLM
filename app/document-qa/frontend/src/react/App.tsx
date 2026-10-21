import { AppProviders, useNavigation, type AppRuntime } from './providers';
import { AppShell } from '../lib/features/desktop-shell/react/AppShell';
import { ChatPage } from '../lib/features/answering/react/ChatPage';
import { LibraryPage } from '../lib/features/library/react/LibraryPage';
import { HistoryPage } from '../lib/features/history/react/HistoryPage';
import { SettingsPage } from '../lib/features/settings/react/SettingsPage';

function RoutedPages() {
	const { route } = useNavigation();
	switch (route.path) {
		case '/library': return <LibraryPage />;
		case '/history': return <HistoryPage />;
		case '/settings': return <SettingsPage />;
		default: return <ChatPage key={route.chatEpoch} />;
	}
}

export default function App({ runtime }: { runtime?: AppRuntime }) {
	return (
		<AppProviders runtime={runtime}>
			<AppShell>
				<RoutedPages />
			</AppShell>
		</AppProviders>
	);
}
