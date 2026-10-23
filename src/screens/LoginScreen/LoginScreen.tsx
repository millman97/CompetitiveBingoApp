import AppHeader from '../../components/AppHeader/AppHeader';
import LoginForm from '../../components/LoginForm/LoginForm';

const LoginScreen = ({ onIn }: { onIn: () => void }) => (
  <div className='app-shell'>
    <AppHeader active='admin' />
    <main className='login-panel panel'>
      <h1 className='mb-3 text-3xl font-bold text-gold'>Admin sign in</h1>
      <p className='mb-4 text-sm text-parchment-dim'>
        Use the admin password set by the person hosting this server. Players do
        not need to sign in here.
      </p>
      <LoginForm onIn={onIn} />
      <a
        href='/'
        className='mt-4 text-sm underline'
      >
        Back to events
      </a>
    </main>
  </div>
);

export default LoginScreen;
