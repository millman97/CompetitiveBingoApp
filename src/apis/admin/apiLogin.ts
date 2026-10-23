import { post } from './apiRequest';

const apiLogin = (password: string) => post('/login', { password });

export default apiLogin;
