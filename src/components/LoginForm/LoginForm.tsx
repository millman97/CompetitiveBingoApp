import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import apiLogin from '../../apis/admin/apiLogin';
import Button from '../Button/Button';
import Field from '../Field/Field';
import Input from '../Input/Input';
import Panel from '../Panel/Panel';

const LoginForm = ({ onIn }: { onIn: () => void }) => {
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: () => apiLogin(password),
    onSuccess: onIn,
  });

  return (
    <Panel title='Sign in'>
      <form
        className='space-y-3'
        onSubmit={(event) => {
          event.preventDefault();
          if (!login.isPending) login.mutate();
        }}
      >
        <Field label='Admin password'>
          <Input
            type='password'
            autoComplete='current-password'
            required
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>

        {login.isError ? (
          <p
            role='alert'
            className='text-sm text-error'
          >
            {(login.error as Error).message}
          </p>
        ) : null}

        <Button
          type='submit'
          tone='primary'
          disabled={login.isPending || password === ''}
        >
          {login.isPending ? 'Checking…' : 'Sign in'}
        </Button>
      </form>
    </Panel>
  );
};

export default LoginForm;
