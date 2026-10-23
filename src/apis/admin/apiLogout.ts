import { post } from './apiRequest';

const apiLogout = () => post('/logout');

export default apiLogout;
