import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import apiFetchSession from '../../apis/admin/apiFetchSession';
import apiLogout from '../../apis/admin/apiLogout';
import AppHeader from '../AppHeader/AppHeader';

import ErrorMessage from '../../error/ErrorMessage';
import LoginScreen from '../../screens/LoginScreen/LoginScreen';
import Button from '../Button/Button';
import Dialog from '../Dialog/Dialog';
import Loading from '../Loading/Loading';
import LoginForm from '../LoginForm/LoginForm';

const AdminLayout = ({ children }: { children: ReactNode }) => {
  const client = useQueryClient();
  const [sessionExpired, setSessionExpired] = useState(false);
  const hadSession = useRef(false);
  useEffect(() => {
    const expired = () => setSessionExpired(true);
    window.addEventListener('admin-session-expired', expired);
    return () => window.removeEventListener('admin-session-expired', expired);
  }, [client]);
  const session = useQuery({
    queryKey: ['admin', 'session'],
    queryFn: () => apiFetchSession(),
  });
  if (session.data?.authenticated) hadSession.current = true;
  const signedIn = () => {
    client.setQueryData(['admin', 'session'], { authenticated: true });
    setSessionExpired(false);
    void client.invalidateQueries({ queryKey: ['admin', 'session'] });
  };
  const logout = useMutation({
    mutationFn: () => apiLogout(),
    onSuccess: () => {
      client.removeQueries({ queryKey: ['admin'] });
      window.location.assign('/admin');
    },
  });

  if (session.isLoading && !hadSession.current)
    return <Loading message='Checking your session…' />;
  if (session.isError && !hadSession.current)
    return (
      <ErrorMessage
        error={session.error}
        onRetry={() => void session.refetch()}
      />
    );
  if (!hadSession.current) {
    return <LoginScreen onIn={signedIn} />;
  }

  return (
    <div className='app-shell'>
      <a
        href='#content'
        className='skip-link'
      >
        Skip to content
      </a>
      <AppHeader
        active='admin'
        actions={
          <>
            <span className='eyebrow hidden sm:inline'>Organiser</span>
            <Button
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              {logout.isPending ? 'Signing out…' : 'Sign out'}
            </Button>
          </>
        }
      />
      {logout.isError && <ErrorMessage error={logout.error} />}
      <main
        id='content'
        className='app-main'
      >
        {children}
      </main>
      {(sessionExpired || session.data?.authenticated === false) && (
        <Dialog
          title='Sign in again to continue'
          onClose={() => {}}
          dismissible={false}
        >
          <p className='text-sm'>
            Your session expired. Your current edits are kept on this page. Sign
            in, then retry your last action.
          </p>
          <LoginForm onIn={signedIn} />
          <a
            href='/admin'
            className='text-sm underline'
          >
            Leave this page and return to events
          </a>
        </Dialog>
      )}
    </div>
  );
};

export default AdminLayout;
