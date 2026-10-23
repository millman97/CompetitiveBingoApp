import Button from '../components/Button/Button';

const ErrorMessage = ({
  error,
  onRetry,
}: {
  error: Error;
  onRetry?: () => void;
}) => (
  <div
    role='alert'
    className='panel space-y-3 p-4'
  >
    <p className='font-bold text-parchment'>{error.message}</p>
    {onRetry && <Button onClick={onRetry}>Try again</Button>}
  </div>
);

export default ErrorMessage;
