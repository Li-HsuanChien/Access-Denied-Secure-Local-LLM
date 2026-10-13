import { workflowRequest } from '../workflowTransport';

export interface UserSettings { general_knowledge: boolean; history_enabled?: boolean }
export interface SettingsClient {
	read(): Promise<UserSettings>;
	update(value: Pick<UserSettings, 'general_knowledge'>): Promise<UserSettings>;
}
export const createSettingsClient = (): SettingsClient => ({
	read: () => workflowRequest('settings.get'),
	update: (value) => workflowRequest('settings.update', value)
});
