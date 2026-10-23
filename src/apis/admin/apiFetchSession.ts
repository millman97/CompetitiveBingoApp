import { get } from './apiRequest';

const apiFetchSession = () => get<{ authenticated: boolean }>('/session');

export default apiFetchSession;
